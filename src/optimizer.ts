import {
  calculateStat,
  PROTECTED_EXPOSURE_KEYS,
  WARNING_LIMITS,
} from "./calculations";
import type { ParsedStat } from "./types";

export const OPTIMIZER_STAT_OPTIONS = [
  ["stalker.artefact_properties.factor.speed_modifier", "Movement speed", true],
  ["stalker.artefact_properties.factor.sprint_speed_modifier", "Running speed", true],
  ["stalker.artefact_properties.factor.stamina_bonus", "Stamina", true],
  ["stalker.artefact_properties.factor.stamina_regeneration_bonus", "Stamina regeneration", true],
  ["stalker.artefact_properties.factor.max_weight_bonus", "Carry weight", false],
  ["stalker.artefact_properties.factor.health_bonus", "Vitality", true],
  ["stalker.artefact_properties.factor.regeneration_bonus", "Health regeneration", true],
  ["stalker.artefact_properties.factor.heal_efficiency", "Healing effectiveness", true],
  ["stalker.artefact_properties.factor.bullet_dmg_factor", "Bullet resistance", false],
  ["stalker.artefact_properties.factor.explosion_dmg_factor", "Explosion protection", false],
  ["stalker.artefact_properties.factor.tear_dmg_factor", "Laceration protection", false],
] as const;

export type OptimizerHarmfulOption = {
  key: string;
  name: string;
  harmfulDirection: 1 | -1;
  safeLimit: number | null;
};

export type NegativeEffectPolicy = "allow" | "safe" | "strict" | "custom";

export const OPTIMIZER_HARMFUL_OPTIONS: readonly OptimizerHarmfulOption[] = [
  { key: "stalker.artefact_properties.factor.radiation_accumulation", name: "Radiation", harmfulDirection: 1, safeLimit: WARNING_LIMITS["stalker.artefact_properties.factor.radiation_accumulation"] },
  { key: "stalker.artefact_properties.factor.biological_accumulation", name: "Biological infection", harmfulDirection: 1, safeLimit: WARNING_LIMITS["stalker.artefact_properties.factor.biological_accumulation"] },
  { key: "stalker.artefact_properties.factor.psycho_accumulation", name: "Psy-emissions", harmfulDirection: 1, safeLimit: WARNING_LIMITS["stalker.artefact_properties.factor.psycho_accumulation"] },
  { key: "stalker.artefact_properties.factor.thermal_accumulation", name: "Temperature", harmfulDirection: 1, safeLimit: WARNING_LIMITS["stalker.artefact_properties.factor.thermal_accumulation"] },
  { key: "stalker.artefact_properties.factor.frost_accumulation", name: "Frost", harmfulDirection: 1, safeLimit: WARNING_LIMITS["stalker.artefact_properties.factor.frost_accumulation"] },
  { key: "stalker.artefact_properties.factor.recoil_bonus", name: "Recoil", harmfulDirection: 1, safeLimit: null },
  { key: "stalker.artefact_properties.factor.health_bonus", name: "Vitality", harmfulDirection: -1, safeLimit: null },
  { key: "stalker.artefact_properties.factor.heal_efficiency", name: "Healing effectiveness", harmfulDirection: -1, safeLimit: null },
  { key: "stalker.artefact_properties.factor.bullet_dmg_factor", name: "Bullet resistance", harmfulDirection: -1, safeLimit: null },
  { key: "stalker.artefact_properties.factor.bleeding_protection", name: "Bleeding protection", harmfulDirection: -1, safeLimit: null },
  { key: "stalker.artefact_properties.factor.reaction_to_burn", name: "Reaction to burns", harmfulDirection: -1, safeLimit: null },
  { key: "stalker.artefact_properties.factor.speed_modifier", name: "Movement speed", harmfulDirection: -1, safeLimit: null },
  { key: "stalker.artefact_properties.factor.sprint_speed_modifier", name: "Running speed", harmfulDirection: -1, safeLimit: null },
];

export type OptimizerObjective = {
  key: string;
  weight: number;
};

export type OptimizerConstraint = {
  key: string;
  minimum: number | null;
  maximum: number | null;
  scope: "artifact" | "final";
};

export function harmfulEffectConstraint(
  option: OptimizerHarmfulOption,
  policy: NegativeEffectPolicy,
  customLimit: number | null,
): OptimizerConstraint | null {
  if (policy === "allow") return null;
  const acceptedPenalty = policy === "safe"
    ? option.safeLimit
    : policy === "strict"
      ? 0
      : customLimit;
  if (acceptedPenalty === null) return null;
  return {
    key: option.key,
    minimum: option.harmfulDirection === -1 ? -acceptedPenalty : null,
    maximum: option.harmfulDirection === 1 ? acceptedPenalty : null,
    scope: "final",
  };
}

export type OptimizerCandidate = {
  name: string;
  stats: ParsedStat[];
  price: number | null;
};

export type OptimizerContainer = {
  capacity: number;
  protection: number;
  effectiveness: number;
  stats: ParsedStat[];
};

export type OptimizerSettings = {
  quality: number;
  level: number;
  rarityIndex: number;
  allowDuplicates: boolean;
  constraints: OptimizerConstraint[];
  maxTotalPrice: number | null;
  resultLimit?: number;
  combinationLimit?: number;
};

export type OptimizerRange = {
  key: string;
  min: number;
  max: number;
};

export type OptimizerResult = {
  indices: number[];
  score: number;
  values: number[];
  totalPrice: number | null;
};

export type OptimizerSearchResult = {
  combinations: number;
  feasibleCombinations: number | null;
  ranges: OptimizerRange[];
  results: OptimizerResult[];
};

export type OptimizerProgress = {
  phase: "ranges" | "ranking";
  completed: number;
  total: number;
};

const DEFAULT_COMBINATION_LIMIT = 10_000_000;
const DEFAULT_RESULT_LIMIT = 10;
const EPSILON = 1e-10;

export class SearchSpaceTooLargeError extends Error {
  combinations: number;
  limit: number;

  constructor(combinations: number, limit: number) {
    super(`This exact search contains ${combinations.toLocaleString()} combinations; the current limit is ${limit.toLocaleString()}.`);
    this.name = "SearchSpaceTooLargeError";
    this.combinations = combinations;
    this.limit = limit;
  }
}

export function combinationCount(candidateCount: number, slots: number, allowDuplicates: boolean) {
  if (slots < 0 || candidateCount < 0) return 0;
  if (slots === 0) return 1;
  if (candidateCount === 0 || (!allowDuplicates && slots > candidateCount)) return 0;
  return binomial(allowDuplicates ? candidateCount + slots - 1 : candidateCount, slots);
}

export function optimizeArtifactCombinations(
  container: OptimizerContainer,
  candidates: OptimizerCandidate[],
  objectives: OptimizerObjective[],
  settings: OptimizerSettings,
  onProgress?: (progress: OptimizerProgress) => void,
): OptimizerSearchResult {
  const activeObjectives = objectives.filter((objective) => objective.weight > 0);
  if (activeObjectives.length === 0) throw new Error("Add at least one objective with a positive weight.");

  const combinations = combinationCount(candidates.length, container.capacity, settings.allowDuplicates);
  const combinationLimit = settings.combinationLimit ?? DEFAULT_COMBINATION_LIMIT;
  if (combinations > combinationLimit) throw new SearchSpaceTooLargeError(combinations, combinationLimit);
  if (combinations === 0) return { combinations, feasibleCombinations: 0, ranges: [], results: [] };

  const relevantKeys = [...new Set([
    ...activeObjectives.map((objective) => objective.key),
    ...settings.constraints.map((constraint) => constraint.key),
  ])];
  const keyIndexes = new Map(relevantKeys.map((key, index) => [key, index]));
  const objectiveIndexes = activeObjectives.map((objective) => keyIndexes.get(objective.key)!);
  const carrierValues = new Float64Array(relevantKeys.length);
  for (const stat of container.stats) {
    const index = keyIndexes.get(stat.key);
    if (index !== undefined) carrierValues[index] += stat.max;
  }

  const vectors = candidates.map((candidate) => {
    const values = new Float64Array(relevantKeys.length);
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

  const finalizeValue = (key: string, index: number, rawValue: number) => {
    const protectedValue = PROTECTED_EXPOSURE_KEYS.has(key) && rawValue > 0
      ? rawValue * (1 - container.protection / 100)
      : rawValue;
    return protectedValue + carrierValues[index];
  };

  const satisfiesConstraints = (sums: Float64Array) => settings.constraints.every((constraint) => {
    const index = keyIndexes.get(constraint.key)!;
    const value = constraint.scope === "artifact"
      ? sums[index]
      : finalizeValue(constraint.key, index, sums[index]);
    return (constraint.minimum === null || value >= constraint.minimum - EPSILON)
      && (constraint.maximum === null || value <= constraint.maximum + EPSILON);
  });
  const totalPrice = (indices: Int32Array) => {
    let total = 0;
    for (const candidateIndex of indices) {
      const price = candidates[candidateIndex].price;
      if (price === null) return null;
      total += price;
    }
    return total;
  };
  const withinBudget = (indices: Int32Array) => {
    if (settings.maxTotalPrice === null) return true;
    const price = totalPrice(indices);
    return price !== null && price <= settings.maxTotalPrice + EPSILON;
  };
  const eligible = (sums: Float64Array, indices: Int32Array) =>
    satisfiesConstraints(sums)
    && withinBudget(indices);

  const mins = new Float64Array(activeObjectives.length).fill(Number.POSITIVE_INFINITY);
  const maxes = new Float64Array(activeObjectives.length).fill(Number.NEGATIVE_INFINITY);
  let feasibleCombinations = 0;
  enumerateCombinations(
    vectors,
    container.capacity,
    settings.allowDuplicates,
    combinations,
    "ranges",
    onProgress,
    (sums, indices) => {
      if (!eligible(sums, indices)) return;
      feasibleCombinations += 1;
      objectiveIndexes.forEach((index, objectiveIndex) => {
        const value = finalizeValue(activeObjectives[objectiveIndex].key, index, sums[index]);
        mins[objectiveIndex] = Math.min(mins[objectiveIndex], value);
        maxes[objectiveIndex] = Math.max(maxes[objectiveIndex], value);
      });
    },
  );

  if (feasibleCombinations === 0) {
    return {
      combinations,
      feasibleCombinations,
      ranges: activeObjectives.map((objective) => ({ key: objective.key, min: 0, max: 0 })),
      results: [],
    };
  }

  const totalWeight = activeObjectives.reduce((sum, objective) => sum + objective.weight, 0);
  const resultLimit = settings.resultLimit ?? DEFAULT_RESULT_LIMIT;
  const results: OptimizerResult[] = [];
  enumerateCombinations(
    vectors,
    container.capacity,
    settings.allowDuplicates,
    combinations,
    "ranking",
    onProgress,
    (sums, indices) => {
      if (!eligible(sums, indices)) return;
      const values = objectiveIndexes.map((index, objectiveIndex) =>
        finalizeValue(activeObjectives[objectiveIndex].key, index, sums[index]));
      const score = values.reduce((sum, value, objectiveIndex) => {
        const span = maxes[objectiveIndex] - mins[objectiveIndex];
        const normalized = Math.abs(span) <= EPSILON ? 1 : (value - mins[objectiveIndex]) / span;
        return sum + normalized * activeObjectives[objectiveIndex].weight;
      }, 0) / totalWeight;
      insertResult(results, {
        indices: [...indices],
        score,
        values,
        totalPrice: totalPrice(indices),
      }, resultLimit);
    },
  );

  return {
    combinations,
    feasibleCombinations,
    ranges: activeObjectives.map((objective, index) => ({
      key: objective.key,
      min: mins[index],
      max: maxes[index],
    })),
    results,
  };
}

function enumerateCombinations(
  vectors: Float64Array[],
  slots: number,
  allowDuplicates: boolean,
  total: number,
  phase: OptimizerProgress["phase"],
  onProgress: ((progress: OptimizerProgress) => void) | undefined,
  visit: (sums: Float64Array, indices: Int32Array) => void,
) {
  const sums = new Float64Array(vectors[0]?.length ?? 0);
  const indices = new Int32Array(slots);
  let completed = 0;
  let lastProgress = 0;

  const walk = (depth: number, start: number) => {
    if (depth === slots) {
      completed += 1;
      visit(sums, indices);
      if (onProgress && (completed - lastProgress >= 25_000 || completed === total)) {
        lastProgress = completed;
        onProgress({ phase, completed, total });
      }
      return;
    }

    const remaining = slots - depth;
    const finalIndex = allowDuplicates ? vectors.length - 1 : vectors.length - remaining;
    for (let candidateIndex = start; candidateIndex <= finalIndex; candidateIndex += 1) {
      indices[depth] = candidateIndex;
      const vector = vectors[candidateIndex];
      for (let index = 0; index < sums.length; index += 1) sums[index] += vector[index];
      walk(depth + 1, allowDuplicates ? candidateIndex : candidateIndex + 1);
      for (let index = 0; index < sums.length; index += 1) sums[index] -= vector[index];
    }
  };

  walk(0, 0);
}

function insertResult(results: OptimizerResult[], result: OptimizerResult, limit: number) {
  const isBetter = (left: OptimizerResult, right: OptimizerResult) => {
    if (Math.abs(left.score - right.score) > EPSILON) return left.score > right.score;
    return left.indices.join(",") < right.indices.join(",");
  };
  if (results.length === limit && !isBetter(result, results[results.length - 1])) return;
  const index = results.findIndex((current) => isBetter(result, current));
  results.splice(index < 0 ? results.length : index, 0, result);
  if (results.length > limit) results.pop();
}

function binomial(n: number, k: number) {
  const count = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= count; index += 1) {
    result = (result * (n - count + index)) / index;
  }
  return Math.round(result);
}
