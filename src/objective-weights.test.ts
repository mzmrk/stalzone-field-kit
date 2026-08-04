import { describe, expect, it } from "vitest";
import {
  addNeutralObjectiveWeight,
  rebalanceObjectiveWeights,
  removeObjectiveWeight,
} from "./objective-weights";

describe("objective percentage weights", () => {
  it("keeps the total at 100 while a slider changes", () => {
    expect(rebalanceObjectiveWeights([70, 30], 0, 60)).toEqual([60, 40]);
    expect(rebalanceObjectiveWeights([50, 49, 1], 0, 100)).toEqual([98, 1, 1]);
  });

  it("adds a neutral share without losing the existing preference ratio", () => {
    expect(addNeutralObjectiveWeight([70, 30])).toEqual([47, 20, 33]);
  });

  it("redistributes a removed objective's share proportionally", () => {
    expect(removeObjectiveWeight([47, 20, 33], 2)).toEqual([70, 30]);
  });
});
