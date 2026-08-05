import {
  calculateStat,
  EXPOSURE_KEYS,
  PROTECTED_EXPOSURE_KEYS,
  WARNING_LIMITS,
} from "./calculations";
import {
  combinationCount,
  type OptimizerCandidate,
  type OptimizerContainer,
  type OptimizerObjective,
  type OptimizerResult,
  type OptimizerSearchResult,
  type OptimizerSettings,
} from "./optimizer";
import type { ParsedStat } from "./types";

const EPSILON = 1e-10;
const REQUIRED_OBJECTIVE_MIN = 1e-7;

export type MilpProgress = {
  completed: number;
  total: number;
};

export type MilpSolution = {
  Status: string;
  Columns: Record<string, unknown>;
};

export type MilpSolver = {
  solve(problem: string, options?: Record<string, unknown>): MilpSolution;
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
};

export async function optimizeArtifactCombinationsMilp(
  solver: MilpSolver,
  container: OptimizerContainer,
  candidates: OptimizerCandidate[],
  objectives: OptimizerObjective[],
  settings: OptimizerSettings,
  onProgress?: (progress: MilpProgress) => void,
): Promise<OptimizerSearchResult> {
  const activeObjectives = objectives.filter((objective) => objective.weight > 0);
  if (activeObjectives.length === 0) throw new Error("Add at least one objective with a positive weight.");

  const combinations = combinationCount(candidates.length, container.capacity, settings.allowDuplicates);
  if (combinations === 0) {
    return { combinations, feasibleCombinations: 0, ranges: [], results: [] };
  }

  const prepared = prepareProblem(container, candidates, activeObjectives, settings);
  const solveCount = activeObjectives.length * 2 + 1;
  let completed = 0;
  const solve = (coefficients: Float64Array, maximize: boolean) => {
    const result = solver.solve(buildLp(prepared, coefficients, maximize), {
      output_flag: false,
      log_to_console: false,
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
    assertOptimal(minimum);
    const maximum = solve(coefficients, true);
    assertOptimal(maximum);
    ranges.push({
      key: activeObjectives[objectiveIndex].key,
      min: objectiveValue(minimum, prepared, objectiveIndex),
      max: objectiveValue(maximum, prepared, objectiveIndex),
    });
  }

  const totalWeight = activeObjectives.reduce((sum, objective) => sum + objective.weight, 0);
  const scoreCoefficients = new Float64Array(candidates.length);
  activeObjectives.forEach((objective, objectiveIndex) => {
    const span = ranges[objectiveIndex].max - ranges[objectiveIndex].min;
    if (Math.abs(span) <= EPSILON) return;
    const vectorIndex = prepared.objectiveIndexes[objectiveIndex];
    prepared.vectors.forEach((vector, candidateIndex) => {
      scoreCoefficients[candidateIndex] += vector[vectorIndex] * objective.weight / span / totalWeight;
    });
  });

  const best = solve(scoreCoefficients, true);
  if (best.Status === "Infeasible") {
    return { combinations, feasibleCombinations: 0, ranges, results: [] };
  }
  assertOptimal(best);
  const indices = selectedIndices(best, candidates.length, container.capacity);
  const values = activeObjectives.map((_, objectiveIndex) =>
    selectedObjectiveValue(indices, prepared, objectiveIndex));
  const score = values.reduce((sum, value, objectiveIndex) => {
    const span = ranges[objectiveIndex].max - ranges[objectiveIndex].min;
    const normalized = Math.abs(span) <= EPSILON ? 1 : (value - ranges[objectiveIndex].min) / span;
    return sum + normalized * activeObjectives[objectiveIndex].weight;
  }, 0) / totalWeight;
  const totalPrice = indices.reduce<number | null>((total, index) => {
    const price = candidates[index].price;
    return total === null || price === null ? null : total + price;
  }, 0);
  const result: OptimizerResult = { indices, score, values, totalPrice };

  return {
    combinations,
    feasibleCombinations: null,
    ranges,
    results: [result],
  };
}

function prepareProblem(
  container: OptimizerContainer,
  candidates: OptimizerCandidate[],
  objectives: OptimizerObjective[],
  settings: OptimizerSettings,
): PreparedProblem {
  const harmfulDirections = new Map<string, number>();
  const registerHarmfulDirection = (stat: ParsedStat) => {
    if (stat.positive || harmfulDirections.has(stat.key)) return;
    const endpoint = Math.abs(stat.max) >= Math.abs(stat.min) ? stat.max : stat.min;
    const direction = Math.sign(endpoint);
    if (direction !== 0) harmfulDirections.set(stat.key, direction);
  };
  container.stats.forEach(registerHarmfulDirection);
  candidates.forEach((candidate) => candidate.stats.forEach(registerHarmfulDirection));

  const keys = [...new Set([
    ...objectives.map((objective) => objective.key),
    ...EXPOSURE_KEYS,
    ...harmfulDirections.keys(),
  ])];
  const keyIndexes = new Map(keys.map((key, index) => [key, index]));
  const carrierValues = new Float64Array(keys.length);
  for (const stat of container.stats) {
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
        settings.quality,
        settings.level,
        settings.rarityIndex,
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
  const coefficientsFor = (key: string) => {
    const index = keyIndexes.get(key)!;
    return Float64Array.from(vectors, (vector) => vector[index]);
  };

  if (settings.safeOnly) {
    for (const key of EXPOSURE_KEYS) {
      const index = keyIndexes.get(key)!;
      const bound = rawUpperBound(key, WARNING_LIMITS[key], carrierValues[index], container.protection);
      if (bound !== null) constraints.push({
        name: `safe_${constraints.length}`,
        coefficients: coefficientsFor(key),
        sense: "<=",
        rhs: bound,
      });
    }
  }
  if (settings.noNegativeEffects) {
    for (const [key, direction] of harmfulDirections) {
      const index = keyIndexes.get(key)!;
      if (direction > 0) {
        const bound = rawUpperBound(key, EPSILON, carrierValues[index], container.protection);
        if (bound !== null) constraints.push({
          name: `nonnegative_${constraints.length}`,
          coefficients: coefficientsFor(key),
          sense: "<=",
          rhs: bound,
        });
      } else {
        const bound = rawLowerBound(key, -EPSILON, carrierValues[index], container.protection);
        constraints.push({
          name: `nonnegative_${constraints.length}`,
          coefficients: coefficientsFor(key),
          sense: ">=",
          rhs: bound ?? Number.POSITIVE_INFINITY,
        });
      }
    }
  }
  if (settings.requireAllObjectives) {
    objectives.forEach((objective) => constraints.push({
      name: `required_${constraints.length}`,
      coefficients: coefficientsFor(objective.key),
      sense: ">=",
      rhs: REQUIRED_OBJECTIVE_MIN,
    }));
  }
  if (settings.maxTotalPrice !== null) {
    constraints.push({
      name: "budget",
      coefficients: Float64Array.from(candidates, (candidate) => candidate.price ?? 0),
      sense: "<=",
      rhs: settings.maxTotalPrice,
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

function selectedObjectiveValue(indices: number[], prepared: PreparedProblem, objectiveIndex: number) {
  const vectorIndex = prepared.objectiveIndexes[objectiveIndex];
  const raw = indices.reduce((sum, index) => sum + prepared.vectors[index][vectorIndex], 0);
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

function buildLp(prepared: PreparedProblem, objective: Float64Array, maximize: boolean) {
  const lines = [maximize ? "Maximize" : "Minimize", ` obj: ${expression(objective)}`, "Subject To"];
  for (const constraint of prepared.constraints) {
    if (!Number.isFinite(constraint.rhs)) {
      lines.push(` ${constraint.name}: 0 <= -1`);
    } else {
      lines.push(` ${constraint.name}: ${expression(constraint.coefficients)} ${constraint.sense} ${number(constraint.rhs)}`);
    }
  }
  lines.push("Bounds");
  prepared.upperBounds.forEach((upper, index) => lines.push(` 0 <= x${index} <= ${upper}`));
  lines.push("Generals", ...prepared.upperBounds.map((_, index) => ` x${index}`), "End");
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

function assertOptimal(solution: MilpSolution) {
  if (solution.Status !== "Optimal") {
    throw new Error(`MILP solver stopped with status: ${solution.Status}.`);
  }
}
