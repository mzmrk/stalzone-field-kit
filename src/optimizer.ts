import {
  CARRY_WEIGHT_KEY,
  calculateStat,
  PROTECTED_EXPOSURE_KEYS,
  WARNING_LIMITS,
} from "./calculations";
import type { ParsedStat } from "./types";

export const OPTIMIZER_STAT_OPTIONS = [
  ["stalker.artefact_properties.factor.speed_modifier", "Movement speed", true, 1],
  ["stalker.artefact_properties.factor.bullet_dmg_factor", "Bullet resistance", false, 1],
  ["stalker.artefact_properties.factor.health_bonus", "Vitality", true, 1],
  ["stalker.artefact_properties.factor.artefakt_heal", "Periodic healing", true, 1],
  ["stalker.artefact_properties.factor.sprint_speed_modifier", "Running speed", true, 1],
  ["stalker.artefact_properties.factor.stamina_regeneration_bonus", "Stamina regeneration", true, 1],
  ["stalker.artefact_properties.factor.heal_efficiency", "Healing effectiveness", true, 1],
  ["stalker.artefact_properties.factor.regeneration_bonus", "Health regeneration", true, 1],
  [CARRY_WEIGHT_KEY, "Carry weight", false, 1],
  ["stalker.artefact_properties.factor.stamina_bonus", "Stamina", true, 1],
  ["stalker.artefact_properties.factor.tear_dmg_factor", "Laceration protection", false, 1],
  ["stalker.artefact_properties.factor.explosion_dmg_factor", "Explosion protection", false, 1],
  ["stalker.artefact_properties.factor.bleeding_protection", "Bleeding protection", true, 1],
  ["stalker.artefact_properties.factor.stopping_protection", "Stability", true, 1],
  ["stalker.artefact_properties.factor.reaction_to_burn", "Reaction to burns", true, 1],
  ["stalker.artefact_properties.factor.reaction_to_chemical_burn", "Reaction to chemical burns", true, 1],
  ["stalker.artefact_properties.factor.reaction_to_electroshock", "Reaction to electricity", true, 1],
  ["stalker.artefact_properties.factor.reaction_to_tear", "Reaction to laceration", true, 1],
  ["stalker.artefact_properties.factor.electra_dmg_factor", "Electricity resistance", false, 1],
  ["stalker.artefact_properties.factor.burn_dmg_factor", "Fire resistance", false, 1],
  ["stalker.artefact_properties.factor.biological_protection", "Bioinfection protection", false, 1],
  ["stalker.artefact_properties.factor.psycho_protection", "Psy-emission protection", false, 1],
  ["stalker.artefact_properties.factor.radiation_protection", "Radiation protection", false, 1],
  ["stalker.artefact_properties.factor.thermal_protection", "Thermal protection", false, 1],
  ["stalker.artefact_properties.factor.radiation_accumulation", "Radiation countering", false, -1],
  ["stalker.artefact_properties.factor.biological_accumulation", "Biological infection countering", false, -1],
  ["stalker.artefact_properties.factor.psycho_accumulation", "Psy-emission countering", false, -1],
  ["stalker.artefact_properties.factor.thermal_accumulation", "Temperature countering", false, -1],
  ["stalker.artefact_properties.factor.bleeding_accumulation", "Bleeding countering", false, -1],
  ["stalker.artefact_properties.factor.combustion_accumulation", "Burning countering", false, -1],
  ["stalker.artefact_properties.factor.recoil_bonus", "Recoil reduction", true, -1],
  ["stalker.artefact_properties.factor.wiggle_bonus", "Sway reduction", true, -1],
] as const;

export type ObjectiveDirection = 1 | -1;

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
  direction?: ObjectiveDirection;
};

export type OptimizerConstraint = {
  key: string;
  minimum: number | null;
  maximum: number | null;
  scope: "artifact" | "final";
};

export const MINIMUM_POSITIVE_CONTRIBUTION = 1e-6;

export function requiredPositiveEffectConstraint(
  key: string,
  minimum: number | null,
  direction: ObjectiveDirection = 1,
): OptimizerConstraint {
  const magnitude = minimum ?? MINIMUM_POSITIVE_CONTRIBUTION;
  return {
    key,
    minimum: direction === 1 ? magnitude : null,
    maximum: direction === -1 ? -magnitude : null,
    scope: "artifact",
  };
}

export function normalizedObjectiveValue(
  value: number,
  minimum: number,
  maximum: number,
  direction: ObjectiveDirection = 1,
) {
  const span = maximum - minimum;
  if (Math.abs(span) <= EPSILON) return 1;
  return direction === 1
    ? (value - minimum) / span
    : (maximum - value) / span;
}

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
  identity?: string;
  quality?: number;
  rarityIndex?: number;
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
  solveSeconds?: number;
  approximate?: boolean;
  errorPercent?: number;
};

export type OptimizerResult = {
  indices: number[];
  score: number;
  values: number[];
  totalPrice: number | null;
  solveSeconds?: number;
  approximate?: boolean;
  errorPercent?: number;
};

export type OptimizerSearchResult = {
  combinations: number | bigint;
  feasibleCombinations: number | null;
  ranges: OptimizerRange[];
  results: OptimizerResult[];
};

export type OptimizerProgress = {
  phase: "ranges" | "ranking";
  completed: number;
  total: number;
};

export const BRUTE_FORCE_COMBINATION_LIMIT = 10_000_000;

export type OptimizerEngine = "brute-force" | "milp";

export function optimizerEngineFor(
  combinations: number | bigint,
  bruteForceLimit = BRUTE_FORCE_COMBINATION_LIMIT,
): OptimizerEngine {
  return typeof combinations === "bigint"
    ? combinations > BigInt(bruteForceLimit) ? "milp" : "brute-force"
    : combinations > bruteForceLimit ? "milp" : "brute-force";
}
const DEFAULT_RESULT_LIMIT = 10;
const EPSILON = 1e-10;

export class SearchSpaceTooLargeError extends Error {
  combinations: number | bigint;
  limit: number;

  constructor(combinations: number | bigint, limit: number) {
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
  return compactCount(binomialBigInt(allowDuplicates ? candidateCount + slots - 1 : candidateCount, slots));
}

export function groupedCombinationCount(
  groupCount: number,
  variantsPerGroup: number,
  slots: number,
  allowDuplicates: boolean,
) {
  if (groupCount < 0 || variantsPerGroup < 0) return 0;
  if (allowDuplicates) return combinationCount(groupCount * variantsPerGroup, slots, true);
  if (slots < 0 || slots > groupCount) return 0;
  return compactCount(binomialBigInt(groupCount, slots) * BigInt(variantsPerGroup) ** BigInt(slots));
}

export function candidateCombinationCount(
  candidates: OptimizerCandidate[],
  slots: number,
  allowDuplicates: boolean,
) {
  if (allowDuplicates) return combinationCount(candidates.length, slots, true);
  if (slots < 0) return 0;
  const groupSizes = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    const identity = candidate.identity ?? `candidate-${index}`;
    groupSizes.set(identity, (groupSizes.get(identity) ?? 0) + 1);
  });
  const counts = new Array<bigint>(slots + 1).fill(0n);
  counts[0] = 1n;
  for (const size of groupSizes.values()) {
    for (let selected = slots; selected >= 1; selected -= 1) {
      counts[selected] += counts[selected - 1] * BigInt(size);
    }
  }
  return compactCount(counts[slots]);
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

  const exactCombinations = candidateCombinationCount(candidates, container.capacity, settings.allowDuplicates);
  const combinationLimit = settings.combinationLimit ?? BRUTE_FORCE_COMBINATION_LIMIT;
  if (typeof exactCombinations === "bigint" || exactCombinations > combinationLimit) {
    throw new SearchSpaceTooLargeError(exactCombinations, combinationLimit);
  }
  const combinations = exactCombinations;
  if (combinations === 0) return { combinations, feasibleCombinations: 0, ranges: [], results: [] };

  const relevantKeys = [...new Set([
    ...activeObjectives.map((objective) => objective.key),
    ...settings.constraints.map((constraint) => constraint.key),
  ])];
  const keyIndexes = new Map(relevantKeys.map((key, index) => [key, index]));
  const objectiveIndexes = activeObjectives.map((objective) => keyIndexes.get(objective.key)!);
  const carrierValues = new Float64Array(relevantKeys.length);
  for (const stat of container.stats) {
    if (stat.key === CARRY_WEIGHT_KEY) continue;
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
        candidate.quality ?? settings.quality,
        settings.level,
        candidate.rarityIndex ?? settings.rarityIndex,
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
  const satisfiesObjectiveDirections = (sums: Float64Array) => activeObjectives.every((objective, objectiveIndex) => {
    const index = objectiveIndexes[objectiveIndex];
    const value = finalizeValue(objective.key, index, sums[index]);
    return objective.direction === -1
      ? value <= EPSILON
      : value >= -EPSILON;
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
    && satisfiesObjectiveDirections(sums)
    && withinBudget(indices);

  const bestValues = new Float64Array(activeObjectives.length);
  let feasibleCombinations = 0;
  enumerateCombinations(
    vectors,
    candidates,
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
        bestValues[objectiveIndex] = activeObjectives[objectiveIndex].direction === -1
          ? Math.min(bestValues[objectiveIndex], value)
          : Math.max(bestValues[objectiveIndex], value);
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
    candidates,
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
        const normalized = normalizedObjectiveValue(
          value,
          activeObjectives[objectiveIndex].direction === -1 ? bestValues[objectiveIndex] : 0,
          activeObjectives[objectiveIndex].direction === -1 ? 0 : bestValues[objectiveIndex],
          activeObjectives[objectiveIndex].direction,
        );
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
      min: objective.direction === -1 ? bestValues[index] : 0,
      max: objective.direction === -1 ? 0 : bestValues[index],
    })),
    results,
  };
}

function enumerateCombinations(
  vectors: Float64Array[],
  candidates: OptimizerCandidate[],
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
  const usedGroups = new Set<string>();

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
      const identity = candidates[candidateIndex].identity ?? `candidate-${candidateIndex}`;
      if (!allowDuplicates && usedGroups.has(identity)) continue;
      indices[depth] = candidateIndex;
      const vector = vectors[candidateIndex];
      for (let index = 0; index < sums.length; index += 1) sums[index] += vector[index];
      if (!allowDuplicates) usedGroups.add(identity);
      walk(depth + 1, allowDuplicates ? candidateIndex : candidateIndex + 1);
      if (!allowDuplicates) usedGroups.delete(identity);
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

function binomialBigInt(n: number, k: number) {
  const count = Math.min(k, n - k);
  let result = 1n;
  for (let index = 1; index <= count; index += 1) {
    result = result * BigInt(n - count + index) / BigInt(index);
  }
  return result;
}

function compactCount(count: bigint): number | bigint {
  return count <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : count;
}
