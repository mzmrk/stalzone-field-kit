import { describe, expect, it } from "vitest";
import {
  NEUTRAL_OBJECTIVE_WEIGHT,
  OBJECTIVE_PRIORITIES,
  objectiveWeightPercentage,
} from "./objective-priorities";

describe("objective importance levels", () => {
  it("doubles influence at each step around neutral", () => {
    expect(OBJECTIVE_PRIORITIES.map((priority) => priority.weight)).toEqual([1, 2, 4, 8, 16]);
    expect(NEUTRAL_OBJECTIVE_WEIGHT).toBe(4);
  });

  it("gives neutral objectives equal scoring shares", () => {
    const weights = [NEUTRAL_OBJECTIVE_WEIGHT, NEUTRAL_OBJECTIVE_WEIGHT, NEUTRAL_OBJECTIVE_WEIGHT];
    weights.forEach((weight) => expect(objectiveWeightPercentage(weight, weights)).toBeCloseTo(100 / 3));
  });

  it("reports normalized shares without changing other priorities", () => {
    const weights = [8, 4, 2];
    expect(objectiveWeightPercentage(weights[0], weights)).toBeCloseTo(57.14, 2);
    expect(objectiveWeightPercentage(weights[1], weights)).toBeCloseTo(28.57, 2);
    expect(objectiveWeightPercentage(weights[2], weights)).toBeCloseTo(14.29, 2);
  });
});
