import {
  CARRY_WEIGHT_KEY,
  calculateStat,
  PROTECTED_EXPOSURE_KEYS,
} from "./calculations";
import {
  candidateCombinationCount,
  normalizedObjectiveValue,
  type OptimizerCandidate,
  type OptimizerContainer,
  type OptimizerObjective,
  type OptimizerResult,
  type OptimizerSearchResult,
  type OptimizerSettings,
} from "./optimizer";

const EPSILON = 1e-10;
const SOLUTION_TOLERANCE = 1e-7;
export const MILP_RANGE_TIME_LIMIT_SECONDS = 5;
export const MILP_RANK_TIME_LIMIT_SECONDS = 10;

export type MilpProgress = {
  completed: number;
  total: number;
};

export type MilpSolution = {
  Status: string;
  Columns: Record<string, unknown>;
  ObjectiveValue?: number;
  Bound?: number;
  Gap?: number;
  HasFeasibleSolution?: boolean;
};

export type MilpSolver = {
  solve(problem: string, options?: Record<string, boolean | number | string>): MilpSolution;
};

type LinearConstraint = {
  name: string;
  coefficients: Float64Array;
  sense: "<=" | ">=" | "=";
  rhs: number;
};

type PreparedProblem = {
  vectors: Float64Array[];
  keyIndexes: Map<string, number>;
  carrierValues: Float64Array;
  objectiveIndexes: number[];
  constraints: LinearConstraint[];
  upperBounds: number[];
  protection: number;
  capacity: number;
  allowDuplicates: boolean;
};

export async function optimizeArtifactCombinationsMilp(
  solver: MilpSolver,
  container: OptimizerContainer,
  candidates: OptimizerCandidate[],
  objectives: OptimizerObjective[],
  settings: OptimizerSettings,
  onProgress?: (progress: MilpProgress) => void,
  onResult?: (result: OptimizerSearchResult) => void,
): Promise<OptimizerSearchResult> {
  const activeObjectives = objectives.filter((objective) => objective.weight > 0);
  if (activeObjectives.length === 0) throw new Error("Add at least one objective with a positive weight.");

  const combinations = candidateCombinationCount(candidates, container.capacity, settings.allowDuplicates);
  if (combinations === 0) {
    return { combinations, feasibleCombinations: 0, ranges: [], results: [] };
  }

  const prepared = prepareProblem(container, candidates, activeObjectives, settings);
  const resultLimit = settings.resultLimit ?? 10;
  const solveCount = activeObjectives.length + resultLimit;
  let completed = 0;
  onProgress?.({ completed, total: solveCount });
  const solve = (
    coefficients: Float64Array,
    maximize: boolean,
    excludedSelections: number[][] = [],
    phase: "range" | "ranking" = "range",
  ) => {
    const startedAt = performance.now();
    const result = solver.solve(buildLp(prepared, coefficients, maximize, excludedSelections), {
      output_flag: false,
      log_to_console: false,
      presolve: phase === "ranking" && excludedSelections.length > 0 ? "off" : "on",
      time_limit: phase === "range" ? MILP_RANGE_TIME_LIMIT_SECONDS : MILP_RANK_TIME_LIMIT_SECONDS,
      mip_rel_gap: 0,
      mip_abs_gap: 0,
      mip_feasibility_tolerance: 1e-9,
    });
    completed += 1;
    onProgress?.({ completed, total: solveCount });
    return { result, solveSeconds: (performance.now() - startedAt) / 1_000 };
  };

  const ranges = [] as OptimizerSearchResult["ranges"];
  for (let objectiveIndex = 0; objectiveIndex < activeObjectives.length; objectiveIndex += 1) {
    const coefficients = objectiveCoefficients(prepared, objectiveIndex);
    const direction = activeObjectives[objectiveIndex].direction ?? 1;
    const { result: bestSolution, solveSeconds } = solve(coefficients, direction === 1);
    if (bestSolution.Status === "Infeasible") {
      return {
        combinations,
        feasibleCombinations: 0,
        ranges: activeObjectives.map((objective) => ({ key: objective.key, min: 0, max: 0 })),
        results: [],
      };
    }
    assertUsableSolution(bestSolution, "range");
    const selected = validatedSelectedIndices(
      bestSolution,
      prepared,
      candidates,
      activeObjectives,
      settings,
    );
    validateLinearObjective(bestSolution, selected, coefficients);
    const best = selectedObjectiveValue(selected, prepared, objectiveIndex);
    const bound = objectiveBound(bestSolution, prepared, objectiveIndex, best);
    const exact = isProvenOptimal(bestSolution);
    const bestMagnitude = Math.abs(best);
    const possibleMagnitude = Math.abs(bound);
    const range = {
      key: activeObjectives[objectiveIndex].key,
      min: direction === -1 ? best : 0,
      max: direction === -1 ? 0 : best,
      solveSeconds,
    } as OptimizerSearchResult["ranges"][number];
    if (!exact) {
      range.approximate = true;
      if (bestMagnitude > EPSILON && Number.isFinite(bestSolution.Bound)) {
        range.errorPercent = Math.max(0, (possibleMagnitude / bestMagnitude - 1) * 100);
      }
    }
    ranges.push(range);
  }

  const totalWeight = activeObjectives.reduce((sum, objective) => sum + objective.weight, 0);
  const scoreCoefficients = new Float64Array(candidates.length);
  activeObjectives.forEach((objective, objectiveIndex) => {
    const span = ranges[objectiveIndex].max - ranges[objectiveIndex].min;
    if (Math.abs(span) <= EPSILON) return;
    const vectorIndex = prepared.objectiveIndexes[objectiveIndex];
    const direction = objective.direction ?? 1;
    prepared.vectors.forEach((vector, candidateIndex) => {
      scoreCoefficients[candidateIndex] += vector[vectorIndex] * direction * objective.weight / span / totalWeight;
    });
  });

  const results: OptimizerResult[] = [];
  const solveOrderResults: OptimizerResult[] = [];
  const excludedSelections: number[][] = [];
  for (let resultIndex = 0; resultIndex < resultLimit; resultIndex += 1) {
    const { result: solution, solveSeconds } = solve(scoreCoefficients, true, excludedSelections, "ranking");
    if (solution.Status === "Infeasible") break;
    assertUsableSolution(solution, "ranking");
    const selected = validatedSelectedIndices(
      solution,
      prepared,
      candidates,
      activeObjectives,
      settings,
      excludedSelections,
    );
    validateLinearObjective(solution, selected, scoreCoefficients);
    const values = activeObjectives.map((_, objectiveIndex) =>
      selectedObjectiveValue(selected, prepared, objectiveIndex));
    const score = values.reduce((sum, value, objectiveIndex) => {
      const normalized = normalizedObjectiveValue(
        value,
        ranges[objectiveIndex].min,
        ranges[objectiveIndex].max,
        activeObjectives[objectiveIndex].direction,
      );
      return sum + normalized * activeObjectives[objectiveIndex].weight;
    }, 0) / totalWeight;
    const totalPrice = selected.reduce<number | null>((total, index) => {
      const price = candidates[index].price;
      return total === null || price === null ? null : total + price;
    }, 0);
    const result: OptimizerResult = {
      indices: selected,
      score,
      values,
      totalPrice,
      solveSeconds,
    };
    if (!isProvenOptimal(solution)) {
      result.approximate = true;
      if (Number.isFinite(solution.Bound) && Math.abs(score) > EPSILON) {
        const selectedLinearScore = selectedLinearValue(selected, scoreCoefficients);
        const possibleImprovement = Math.max(0, solution.Bound! - selectedLinearScore);
        result.errorPercent = possibleImprovement / Math.abs(score) * 100;
      }
    }
    solveOrderResults.push(result);
    propagateRankProofs(solveOrderResults);
    results.push(result);
    results.sort((left, right) => right.score - left.score);
    excludedSelections.push(selected);
    onResult?.({
      combinations,
      feasibleCombinations: null,
      ranges,
      results: [...results],
    });
  }

  return {
    combinations,
    feasibleCombinations: null,
    ranges,
    results,
  };
}

function prepareProblem(
  container: OptimizerContainer,
  candidates: OptimizerCandidate[],
  objectives: OptimizerObjective[],
  settings: OptimizerSettings,
): PreparedProblem {
  const keys = [...new Set([
    ...objectives.map((objective) => objective.key),
    ...settings.constraints.map((constraint) => constraint.key),
  ])];
  const keyIndexes = new Map(keys.map((key, index) => [key, index]));
  const carrierValues = new Float64Array(keys.length);
  for (const stat of container.stats) {
    if (stat.key === CARRY_WEIGHT_KEY) continue;
    const index = keyIndexes.get(stat.key);
    if (index !== undefined) carrierValues[index] += stat.max;
  }
  const vectors = candidates.map((candidate) => {
    const values = new Float64Array(keys.length);
    for (const stat of candidate.stats) {
      const index = keyIndexes.get(stat.key);
      if (index === undefined) continue;
      values[index] += calculateStat(
        stat,
        candidate.quality ?? settings.quality,
        settings.level,
        candidate.rarityIndex ?? settings.rarityIndex,
        container.effectiveness,
      );
    }
    return values;
  });
  const constraints: LinearConstraint[] = [{
    name: "slots",
    coefficients: new Float64Array(candidates.length).fill(1),
    sense: "=",
    rhs: container.capacity,
  }];
  if (!settings.allowDuplicates) {
    const groups = new Map<string, number[]>();
    candidates.forEach((candidate, candidateIndex) => {
      const identity = candidate.identity ?? `candidate-${candidateIndex}`;
      const indices = groups.get(identity) ?? [];
      indices.push(candidateIndex);
      groups.set(identity, indices);
    });
    for (const indices of groups.values()) {
      if (indices.length < 2) continue;
      const coefficients = new Float64Array(candidates.length);
      indices.forEach((candidateIndex) => { coefficients[candidateIndex] = 1; });
      constraints.push({
        name: `artifact_identity_${constraints.length}`,
        coefficients,
        sense: "<=",
        rhs: 1,
      });
    }
  }
  const coefficientsFor = (key: string) => {
    const index = keyIndexes.get(key)!;
    return Float64Array.from(vectors, (vector) => vector[index]);
  };

  settings.constraints.forEach((constraint) => {
    const index = keyIndexes.get(constraint.key)!;
    if (constraint.minimum !== null) {
      const bound = constraint.scope === "artifact"
        ? constraint.minimum
        : rawLowerBound(constraint.key, constraint.minimum, carrierValues[index], container.protection);
      constraints.push({
        name: `minimum_${constraints.length}`,
        coefficients: coefficientsFor(constraint.key),
        sense: ">=",
        rhs: bound ?? Number.POSITIVE_INFINITY,
      });
    }
    if (constraint.maximum !== null) {
      const bound = constraint.scope === "artifact"
        ? constraint.maximum
        : rawUpperBound(constraint.key, constraint.maximum, carrierValues[index], container.protection);
      if (bound !== null) constraints.push({
        name: `maximum_${constraints.length}`,
        coefficients: coefficientsFor(constraint.key),
        sense: "<=",
        rhs: bound,
      });
    }
  });
  objectives.forEach((objective) => {
    const index = keyIndexes.get(objective.key)!;
    if (objective.direction === -1) {
      const bound = rawUpperBound(
        objective.key,
        0,
        carrierValues[index],
        container.protection,
      );
      if (bound !== null) constraints.push({
        name: `objective_direction_${constraints.length}`,
        coefficients: coefficientsFor(objective.key),
        sense: "<=",
        rhs: bound,
      });
    } else {
      const bound = rawLowerBound(
        objective.key,
        0,
        carrierValues[index],
        container.protection,
      );
      constraints.push({
        name: `objective_direction_${constraints.length}`,
        coefficients: coefficientsFor(objective.key),
        sense: ">=",
        rhs: bound ?? Number.POSITIVE_INFINITY,
      });
    }
  });
  if (settings.maxTotalPrice !== null) {
    const budgetScale = Math.max(1, Math.abs(settings.maxTotalPrice));
    constraints.push({
      name: "budget",
      coefficients: Float64Array.from(
        candidates,
        (candidate) => (candidate.price ?? 0) / budgetScale,
      ),
      sense: "<=",
      rhs: settings.maxTotalPrice / budgetScale,
    });
  }

  return {
    vectors,
    keyIndexes,
    carrierValues,
    objectiveIndexes: objectives.map((objective) => keyIndexes.get(objective.key)!),
    constraints,
    upperBounds: candidates.map((candidate) =>
      settings.maxTotalPrice !== null && candidate.price === null
        ? 0
        : settings.allowDuplicates ? container.capacity : 1),
    protection: container.protection,
    capacity: container.capacity,
    allowDuplicates: settings.allowDuplicates,
  };
}

function rawUpperBound(key: string, finalTarget: number, carrierValue: number, protection: number) {
  const target = finalTarget - carrierValue;
  if (!PROTECTED_EXPOSURE_KEYS.has(key) || target < 0) return target;
  const factor = 1 - protection / 100;
  return factor <= EPSILON ? null : target / factor;
}

function rawLowerBound(key: string, finalTarget: number, carrierValue: number, protection: number) {
  const target = finalTarget - carrierValue;
  if (!PROTECTED_EXPOSURE_KEYS.has(key) || target <= 0) return target;
  const factor = 1 - protection / 100;
  return factor <= EPSILON ? null : target / factor;
}

function objectiveCoefficients(prepared: PreparedProblem, objectiveIndex: number) {
  const vectorIndex = prepared.objectiveIndexes[objectiveIndex];
  return Float64Array.from(prepared.vectors, (vector) => vector[vectorIndex]);
}

function objectiveBound(
  solution: MilpSolution,
  prepared: PreparedProblem,
  objectiveIndex: number,
  fallback: number,
) {
  if (!Number.isFinite(solution.Bound)) return fallback;
  return finalObjectiveValue(solution.Bound!, prepared, objectiveIndex);
}

function selectedObjectiveValue(indices: number[], prepared: PreparedProblem, objectiveIndex: number) {
  const vectorIndex = prepared.objectiveIndexes[objectiveIndex];
  const raw = indices.reduce((sum, index) => sum + prepared.vectors[index][vectorIndex], 0);
  return finalObjectiveValue(raw, prepared, objectiveIndex);
}

function finalObjectiveValue(raw: number, prepared: PreparedProblem, objectiveIndex: number) {
  const vectorIndex = prepared.objectiveIndexes[objectiveIndex];
  const key = [...prepared.keyIndexes].find(([, index]) => index === vectorIndex)![0];
  return finalStatValue(raw, key, vectorIndex, prepared);
}

function finalStatValue(raw: number, key: string, keyIndex: number, prepared: PreparedProblem) {
  const protectedValue = PROTECTED_EXPOSURE_KEYS.has(key) && raw > 0
    ? raw * (1 - prepared.protection / 100)
    : raw;
  return protectedValue + prepared.carrierValues[keyIndex];
}

function selectedIndices(solution: MilpSolution, upperBounds: number[], capacity: number) {
  const indices: number[] = [];
  for (let index = 0; index < upperBounds.length; index += 1) {
    const column = solution.Columns[`x${index}`] as { Primal?: number } | undefined;
    const primal = column?.Primal ?? 0;
    const count = Math.round(primal);
    if (!Number.isFinite(primal)
      || Math.abs(primal - count) > SOLUTION_TOLERANCE
      || count < 0
      || count > upperBounds[index]) {
      throw new Error("MILP solver returned a non-integral artifact selection.");
    }
    for (let copy = 0; copy < count; copy += 1) indices.push(index);
  }
  if (indices.length !== capacity) {
    throw new Error("MILP solver returned a non-integral artifact selection.");
  }
  return indices;
}

function validatedSelectedIndices(
  solution: MilpSolution,
  prepared: PreparedProblem,
  candidates: OptimizerCandidate[],
  objectives: OptimizerObjective[],
  settings: OptimizerSettings,
  excludedSelections: number[][] = [],
) {
  const selected = selectedIndices(solution, prepared.upperBounds, prepared.capacity);
  validateSelection(selected, prepared, candidates, objectives, settings, excludedSelections);
  return selected;
}

function validateSelection(
  selected: number[],
  prepared: PreparedProblem,
  candidates: OptimizerCandidate[],
  objectives: OptimizerObjective[],
  settings: OptimizerSettings,
  excludedSelections: number[][],
) {
  if (!settings.allowDuplicates) {
    const identities = selected.map((index) => candidates[index].identity ?? `candidate-${index}`);
    if (new Set(identities).size !== identities.length) {
      throw new Error("MILP solver returned duplicate variants of one artifact.");
    }
  }

  const sums = new Float64Array(prepared.keyIndexes.size);
  selected.forEach((candidateIndex) => {
    prepared.vectors[candidateIndex].forEach((value, keyIndex) => { sums[keyIndex] += value; });
  });
  settings.constraints.forEach((constraint) => {
    const keyIndex = prepared.keyIndexes.get(constraint.key)!;
    const value = constraint.scope === "artifact"
      ? sums[keyIndex]
      : finalStatValue(sums[keyIndex], constraint.key, keyIndex, prepared);
    if (constraint.minimum !== null && value < constraint.minimum - validationSlack(constraint.minimum)) {
      throw new Error(`MILP solver returned a build below the ${constraint.key} minimum.`);
    }
    if (constraint.maximum !== null && value > constraint.maximum + validationSlack(constraint.maximum)) {
      throw new Error(`MILP solver returned a build above the ${constraint.key} maximum.`);
    }
  });
  objectives.forEach((objective) => {
    const keyIndex = prepared.keyIndexes.get(objective.key)!;
    const value = finalStatValue(sums[keyIndex], objective.key, keyIndex, prepared);
    if (objective.direction === -1
      ? value > SOLUTION_TOLERANCE
      : value < -SOLUTION_TOLERANCE) {
      throw new Error(`MILP solver returned a build with a harmful ${objective.key} objective.`);
    }
  });

  if (settings.maxTotalPrice !== null) {
    let total = 0;
    for (const candidateIndex of selected) {
      const price = candidates[candidateIndex].price;
      if (price === null) throw new Error("MILP solver returned an unpriced build under a price cap.");
      total += price;
    }
    if (total > settings.maxTotalPrice + validationSlack(settings.maxTotalPrice)) {
      throw new Error("MILP solver returned a build above the price cap.");
    }
  }

  const selectedCounts = selectionCounts(selected, candidates.length);
  if (excludedSelections.some((excluded) => equalCounts(
    selectedCounts,
    selectionCounts(excluded, candidates.length),
  ))) {
    throw new Error("MILP solver returned a previously excluded build.");
  }
}

function validateLinearObjective(solution: MilpSolution, selected: number[], coefficients: Float64Array) {
  if (!Number.isFinite(solution.ObjectiveValue)) return;
  const actual = selectedLinearValue(selected, coefficients);
  if (Math.abs(actual - solution.ObjectiveValue!) > validationSlack(solution.ObjectiveValue!)) {
    throw new Error("MILP solver returned an objective value inconsistent with its artifact selection.");
  }
}

function selectedLinearValue(selected: number[], coefficients: Float64Array) {
  return selected.reduce((sum, candidateIndex) => sum + coefficients[candidateIndex], 0);
}

function selectionCounts(selected: number[], candidateCount: number) {
  const counts = new Int32Array(candidateCount);
  selected.forEach((candidateIndex) => { counts[candidateIndex] += 1; });
  return counts;
}

function equalCounts(left: Int32Array, right: Int32Array) {
  return left.every((count, index) => count === right[index]);
}

function validationSlack(value: number) {
  return SOLUTION_TOLERANCE * Math.max(1, Math.abs(value));
}

function buildLp(
  prepared: PreparedProblem,
  objective: Float64Array,
  maximize: boolean,
  excludedSelections: number[][],
) {
  const lines = [maximize ? "Maximize" : "Minimize", ` obj: ${expression(objective)}`, "Subject To"];
  for (const constraint of prepared.constraints) {
    if (!Number.isFinite(constraint.rhs)) {
      lines.push(` ${constraint.name}: 0 <= -1`);
    } else {
      lines.push(` ${constraint.name}: ${expression(constraint.coefficients)} ${constraint.sense} ${number(constraint.rhs)}`);
    }
  }
  const exclusionVariables: string[] = [];
  excludedSelections.forEach((selection, exclusionIndex) => {
    const counts = new Int32Array(prepared.vectors.length);
    selection.forEach((candidateIndex) => { counts[candidateIndex] += 1; });
    if (!prepared.allowDuplicates) {
      const selected = [...counts]
        .map((count, candidateIndex) => count > 0 ? candidateIndex : -1)
        .filter((candidateIndex) => candidateIndex >= 0);
      const coefficients = new Float64Array(prepared.vectors.length);
      selected.forEach((candidateIndex) => { coefficients[candidateIndex] = 1; });
      lines.push(` exclude_${exclusionIndex}: ${expression(coefficients)} <= ${prepared.capacity - 1}`);
      return;
    }

    const indicators: string[] = [];
    counts.forEach((count, candidateIndex) => {
      const upper = prepared.upperBounds[candidateIndex];
      if (count > 0) {
        const variable = `lo_${exclusionIndex}_${candidateIndex}`;
        indicators.push(variable);
        exclusionVariables.push(variable);
        lines.push(` exclude_${exclusionIndex}_lo_${candidateIndex}: x${candidateIndex} + ${prepared.capacity + 1} ${variable} <= ${count + prepared.capacity}`);
      }
      if (count < upper) {
        const variable = `hi_${exclusionIndex}_${candidateIndex}`;
        indicators.push(variable);
        exclusionVariables.push(variable);
        lines.push(` exclude_${exclusionIndex}_hi_${candidateIndex}: x${candidateIndex} - ${prepared.capacity + 1} ${variable} >= ${count - prepared.capacity}`);
      }
    });
    lines.push(` exclude_${exclusionIndex}: ${indicators.join(" + ")} >= 1`);
  });
  lines.push("Bounds");
  prepared.upperBounds.forEach((upper, index) => lines.push(` 0 <= x${index} <= ${upper}`));
  exclusionVariables.forEach((variable) => lines.push(` 0 <= ${variable} <= 1`));
  lines.push(
    "Generals",
    ...prepared.upperBounds.map((_, index) => ` x${index}`),
    ...exclusionVariables.map((variable) => ` ${variable}`),
    "End",
  );
  return lines.join("\n");
}

function expression(coefficients: Float64Array) {
  const terms: string[] = [];
  coefficients.forEach((coefficient, index) => {
    if (Math.abs(coefficient) <= EPSILON) return;
    const sign = coefficient < 0 ? "-" : terms.length > 0 ? "+" : "";
    terms.push(`${sign} ${number(Math.abs(coefficient))} x${index}`.trim());
  });
  return terms.join(" ") || "0";
}

function number(value: number) {
  return Number(value.toPrecision(15)).toString();
}

function isProvenOptimal(solution: MilpSolution) {
  if (solution.Status === "Optimal") return true;
  return solution.Status === "Time limit reached"
    && solution.HasFeasibleSolution === true
    && solution.Gap !== undefined
    && Math.abs(solution.Gap) <= EPSILON;
}

function propagateRankProofs(solveOrderResults: OptimizerResult[]) {
  for (let index = solveOrderResults.length - 2; index >= 0; index -= 1) {
    const result = solveOrderResults[index];
    const bestRemaining = solveOrderResults[index + 1];
    if (bestRemaining.approximate || result.score + EPSILON < bestRemaining.score) return;
    delete result.approximate;
    delete result.errorPercent;
  }
}

function assertUsableSolution(solution: MilpSolution, phase: "range" | "ranking") {
  if (isProvenOptimal(solution)) return;
  if (solution.Status === "Time limit reached" && solution.HasFeasibleSolution) return;
  if (solution.Status === "Time limit reached") {
    throw new Error(`${phase === "range" ? "A best objective value" : "A ranked build"} could not be found within the time limit.`);
  }
  throw new Error(`MILP solver stopped with status: ${solution.Status}.`);
}
