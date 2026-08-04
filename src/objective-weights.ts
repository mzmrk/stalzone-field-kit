export const OBJECTIVE_WEIGHT_TOTAL = 100;
export const MIN_OBJECTIVE_WEIGHT = 1;

export function rebalanceObjectiveWeights(weights: number[], changedIndex: number, requestedWeight: number) {
  if (weights.length <= 1) return [OBJECTIVE_WEIGHT_TOTAL];
  const maximum = OBJECTIVE_WEIGHT_TOTAL - (weights.length - 1) * MIN_OBJECTIVE_WEIGHT;
  const changedWeight = Math.min(maximum, Math.max(MIN_OBJECTIVE_WEIGHT, Math.round(requestedWeight)));
  const remainingWeights = weights.filter((_, index) => index !== changedIndex);
  const redistributed = allocatePercentages(remainingWeights, OBJECTIVE_WEIGHT_TOTAL - changedWeight);
  let cursor = 0;
  return weights.map((_, index) => index === changedIndex ? changedWeight : redistributed[cursor++]);
}

export function addNeutralObjectiveWeight(weights: number[]) {
  const newWeight = Math.round(OBJECTIVE_WEIGHT_TOTAL / (weights.length + 1));
  return [...allocatePercentages(weights, OBJECTIVE_WEIGHT_TOTAL - newWeight), newWeight];
}

export function removeObjectiveWeight(weights: number[], removedIndex: number) {
  return allocatePercentages(
    weights.filter((_, index) => index !== removedIndex),
    OBJECTIVE_WEIGHT_TOTAL,
  );
}

function allocatePercentages(weights: number[], total: number) {
  if (weights.length === 0) return [];
  const allocated = new Array<number>(weights.length).fill(0);
  let active = weights.map((_, index) => index);
  let remaining = total;

  while (active.length > 0) {
    const weightSum = active.reduce((sum, index) => sum + Math.max(0, weights[index]), 0);
    const divisor = weightSum > 0 ? weightSum : active.length;
    const quota = (index: number) => remaining * (weightSum > 0 ? Math.max(0, weights[index]) : 1) / divisor;
    const belowMinimum = active.filter((index) => quota(index) < MIN_OBJECTIVE_WEIGHT);
    if (belowMinimum.length === 0) {
      const ranked = active.map((index) => {
        const value = quota(index);
        allocated[index] = Math.floor(value);
        return { index, remainder: value - allocated[index] };
      }).sort((left, right) => right.remainder - left.remainder || left.index - right.index);
      let leftover = remaining - active.reduce((sum, index) => sum + allocated[index], 0);
      for (let index = 0; index < leftover; index += 1) allocated[ranked[index].index] += 1;
      break;
    }
    const belowMinimumSet = new Set(belowMinimum);
    belowMinimum.forEach((index) => { allocated[index] = MIN_OBJECTIVE_WEIGHT; });
    remaining -= belowMinimum.length * MIN_OBJECTIVE_WEIGHT;
    active = active.filter((index) => !belowMinimumSet.has(index));
  }

  return allocated;
}
