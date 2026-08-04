export const OBJECTIVE_PRIORITIES = [
  { label: "Minor", weight: 1, factor: "0.25×" },
  { label: "Low", weight: 2, factor: "0.5×" },
  { label: "Neutral", weight: 4, factor: "1×" },
  { label: "Important", weight: 8, factor: "2×" },
  { label: "Essential", weight: 16, factor: "4×" },
] as const;

export const NEUTRAL_OBJECTIVE_WEIGHT = 4;

export function objectiveWeightPercentage(weight: number, weights: number[]) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  return total > 0 ? weight / total * 100 : 0;
}
