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
export const MILP_RANGE_TIME_LIMIT_SECONDS = 1;
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

type CandidateSet = {
  candidates: OptimizerCandidate[];
  originalIndexes: number[];
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

  const candidateSet = reduceDominatedCandidates(container, candidates, activeObjectives, settings);
  if (candidateSet.candidates.length === 0) {
    return {
      combinations,
      feasibleCombinations: 0,
      ranges: activeObjectives.map((objective) => ({ key: objective.key, min: 0, max: 0 })),
      results: [],
    };
  }

  const prepared = prepareProblem(container, candidateSet.candidates, activeObjectives, settings);
  const resultLimit = settings.resultLimit ?? 10;
  const solveCount = activeObjectives.length * 2 + resultLimit;
  let completed = 0;
  onProgress?.({ completed, total: solveCount });
  const solve = (
    coefficients: Float64Array,
    maximize: boolean,
    excludedSelections: number[][] = [],
    phase: "range" | "ranking" = "range",
  ) => {
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
    return result;
  };

  const ranges = [] as OptimizerSearchResult["ranges"];
  for (let objectiveIndex = 0; objectiveIndex < activeObjectives.length; objectiveIndex += 1) {
    const coefficients = objectiveCoefficients(prepared, objectiveIndex);
    const minimum = solve(coefficients, false);
    if (minimum.Status === "Infeasible") {
      return {
        combinations,
        feasibleCombinations: 0,
        ranges: activeObjectives.map((objective) => ({ key: objective.key, min: 0, max: 0 })),
        results: [],
      };
    }
    assertUsableSolution(minimum, "range");
    const maximum = solve(coefficients, true);
    assertUsableSolution(maximum, "range");
    const min = objectiveValue(minimum, prepared, objectiveIndex);
    const max = objectiveValue(maximum, prepared, objectiveIndex);
    const minBound = objectiveBound(minimum, prepared, objectiveIndex, min);
    const maxBound = objectiveBound(maximum, prepared, objectiveIndex, max);
    const exact = isProvenOptimal(minimum) && isProvenOptimal(maximum);
    const span = Math.max(0, max - min);
    const possibleSpan = Math.max(0, maxBound - minBound);
    const range = {
      key: activeObjectives[objectiveIndex].key,
      min,
      max,
    } as OptimizerSearchResult["ranges"][number];
    if (!exact) {
      range.approximate = true;
      if (span > EPSILON && Number.isFinite(minimum.Bound) && Number.isFinite(maximum.Bound)) {
        range.errorPercent = Math.max(0, (possibleSpan / span - 1) * 100);
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
  const excludedSelections: number[][] = [];
  for (let resultIndex = 0; resultIndex < resultLimit; resultIndex += 1) {
    const solution = solve(scoreCoefficients, true, excludedSelections, "ranking");
    if (solution.Status === "Infeasible") break;
    assertUsableSolution(solution, "ranking");
    const reducedIndices = selectedIndices(solution, candidateSet.candidates.length, container.capacity);
    const values = activeObjectives.map((_, objectiveIndex) =>
      selectedObjectiveValue(reducedIndices, prepared, objectiveIndex));
    const score = values.reduce((sum, value, objectiveIndex) => {
      const normalized = normalizedObjectiveValue(
        value,
        ranges[objectiveIndex].min,
        ranges[objectiveIndex].max,
        activeObjectives[objectiveIndex].direction,
      );
      return sum + normalized * activeObjectives[objectiveIndex].weight;
    }, 0) / totalWeight;
    const totalPrice = reducedIndices.reduce<number | null>((total, index) => {
      const price = candidateSet.candidates[index].price;
      return total === null || price === null ? null : total + price;
    }, 0);
    const indices = reducedIndices.map((index) => candidateSet.originalIndexes[index]);
    const result: OptimizerResult = {
      indices,
      score,
      values,
      totalPrice,
    };
    if (!isProvenOptimal(solution)) {
      result.approximate = true;
      if (Number.isFinite(solution.Gap)) {
        result.errorPercent = Math.max(0, solution.Gap! * 100);
      }
    }
    results.push(result);
    results.sort((left, right) => right.score - left.score);
    excludedSelections.push(reducedIndices);
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

function reduceDominatedCandidates(
  container: OptimizerContainer,
  candidates: OptimizerCandidate[],
  objectives: OptimizerObjective[],
  settings: OptimizerSettings,
): CandidateSet {
  const eligible = candidates
    .map((candidate, originalIndex) => ({ candidate, originalIndex }))
    .filter(({ candidate }) => settings.maxTotalPrice === null || candidate.price !== null);
  if (eligible.length < 2) {
    return {
      candidates: eligible.map(({ candidate }) => candidate),
      originalIndexes: eligible.map(({ originalIndex }) => originalIndex),
    };
  }

  const keys = [...new Set([
    ...objectives.map((objective) => objective.key),
    ...settings.constraints.map((constraint) => constraint.key),
  ])];
  const keyIndexes = new Map(keys.map((key, index) => [key, index]));
  const vectors = eligible.map(({ candidate }) => {
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
  const dimensions = [
    ...objectives.map((objective) => ({ kind: "stat" as const, key: objective.key, direction: objective.direction ?? 1 })),
    ...settings.constraints.flatMap((constraint) => [
      ...(constraint.minimum === null ? [] : [{ kind: "stat" as const, key: constraint.key, direction: 1 as const }]),
      ...(constraint.maximum === null ? [] : [{ kind: "stat" as const, key: constraint.key, direction: -1 as const }]),
    ]),
    ...(settings.maxTotalPrice === null ? [] : [{ kind: "price" as const, direction: -1 as const }]),
  ];

  const dominated = new Uint8Array(eligible.length);
  for (let target = 0; target < eligible.length; target += 1) {
    for (let challenger = 0; challenger < eligible.length; challenger += 1) {
      if (target === challenger) continue;
      const targetIdentity = eligible[target].candidate.identity ?? `candidate-${target}`;
      const challengerIdentity = eligible[challenger].candidate.identity ?? `candidate-${challenger}`;
      if (targetIdentity !== challengerIdentity) continue;
      if (dominates(
        vectors[challenger],
        eligible[challenger].candidate.price,
        vectors[target],
        eligible[target].candidate.price,
        dimensions,
        keyIndexes,
      )) {
        dominated[target] = 1;
        break;
      }
    }
  }

  return {
    candidates: eligible.filter((_, index) => !dominated[index]).map(({ candidate }) => candidate),
    originalIndexes: eligible.filter((_, index) => !dominated[index]).map(({ originalIndex }) => originalIndex),
  };
}

function dominates(
  challenger: Float64Array,
  challengerPrice: number | null,
  target: Float64Array,
  targetPrice: number | null,
  dimensions: Array<
    | { kind: "stat"; key: string; direction: 1 | -1 }
    | { kind: "price"; direction: -1 }
  >,
  keyIndexes: Map<string, number>,
) {
  let better = false;
  for (const dimension of dimensions) {
    const challengerValue = dimension.kind === "price"
      ? challengerPrice
      : challenger[keyIndexes.get(dimension.key)!];
    const targetValue = dimension.kind === "price"
      ? targetPrice
      : target[keyIndexes.get(dimension.key)!];
    if (challengerValue === null || targetValue === null) return false;
    const difference = (challengerValue - targetValue) * dimension.direction;
    if (difference < -EPSILON) return false;
    if (difference > EPSILON) better = true;
  }
  return better;
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

function objectiveValue(solution: MilpSolution, prepared: PreparedProblem, objectiveIndex: number) {
  const indices = selectedIndices(solution, prepared.vectors.length);
  return selectedObjectiveValue(indices, prepared, objectiveIndex);
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
  const protectedValue = PROTECTED_EXPOSURE_KEYS.has(key) && raw > 0
    ? raw * (1 - prepared.protection / 100)
    : raw;
  return protectedValue + prepared.carrierValues[vectorIndex];
}

function selectedIndices(solution: MilpSolution, candidateCount: number, capacity?: number) {
  const indices: number[] = [];
  for (let index = 0; index < candidateCount; index += 1) {
    const column = solution.Columns[`x${index}`] as { Primal?: number } | undefined;
    const count = Math.round(column?.Primal ?? 0);
    for (let copy = 0; copy < count; copy += 1) indices.push(index);
  }
  if (capacity !== undefined && indices.length !== capacity) {
    throw new Error("MILP solver returned a non-integral artifact selection.");
  }
  return indices;
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
  if (solution.Status === "Optimal") return Math.abs(solution.Gap ?? 0) <= EPSILON;
  return solution.Status === "Time limit reached"
    && solution.HasFeasibleSolution === true
    && solution.Gap !== undefined
    && Math.abs(solution.Gap) <= EPSILON;
}

function assertUsableSolution(solution: MilpSolution, phase: "range" | "ranking") {
  if (isProvenOptimal(solution)) return;
  if (solution.Status === "Time limit reached" && solution.HasFeasibleSolution) return;
  if (solution.Status === "Time limit reached") {
    throw new Error(`${phase === "range" ? "A feasible range" : "A ranked build"} could not be found within the time limit.`);
  }
  throw new Error(`MILP solver stopped with status: ${solution.Status}.`);
}
