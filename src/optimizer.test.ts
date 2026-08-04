import { describe, expect, it } from "vitest";
import {
  combinationCount,
  optimizeArtifactCombinations,
  type OptimizerCandidate,
  type OptimizerContainer,
} from "./optimizer";
import type { ParsedStat } from "./types";

const MOVEMENT = "stalker.artefact_properties.factor.speed_modifier";
const STAMINA = "stalker.artefact_properties.factor.stamina_regeneration_bonus";
const TEMPERATURE = "stalker.artefact_properties.factor.thermal_accumulation";

const stat = (key: string, name: string, value: number, positive = true): ParsedStat => ({
  key,
  name,
  min: value * 0.85,
  max: value,
  positive,
  percentage: key !== TEMPERATURE,
});

const candidate = (name: string, stats: ParsedStat[]): OptimizerCandidate => ({ name, stats });
const container: OptimizerContainer = {
  capacity: 2,
  protection: 0,
  effectiveness: 100,
  stats: [],
};
const settings = {
  quality: 100,
  level: 0,
  rarityIndex: 0,
  allowDuplicates: true,
  safeOnly: true,
};

describe("artifact optimizer", () => {
  it("counts canonical combinations without generating slot permutations", () => {
    expect(combinationCount(103, 4, true)).toBe(4_967_690);
    expect(combinationCount(103, 4, false)).toBe(4_421_275);
  });

  it("rejects a search before enumeration when it exceeds the configured limit", () => {
    expect(() => optimizeArtifactCombinations(container, [
      candidate("A", []),
      candidate("B", []),
      candidate("C", []),
    ], [{ key: MOVEMENT, weight: 100 }], { ...settings, combinationLimit: 5 }))
      .toThrow(/6 combinations.*limit is 5/);
  });

  it("normalizes against feasible ranges and follows objective weights", () => {
    const candidates = [
      candidate("Sprinter", [stat(MOVEMENT, "Movement speed", 2)]),
      candidate("Charger", [stat(STAMINA, "Stamina regeneration", 4)]),
      candidate("Balanced", [
        stat(MOVEMENT, "Movement speed", 1.2),
        stat(STAMINA, "Stamina regeneration", 2.5),
      ]),
    ];

    const movementFirst = optimizeArtifactCombinations(container, candidates, [
      { key: MOVEMENT, weight: 70 },
      { key: STAMINA, weight: 30 },
    ], settings);
    expect(movementFirst.combinations).toBe(6);
    expect(movementFirst.results[0].indices).toEqual([0, 0]);
    expect(movementFirst.ranges).toEqual([
      { key: MOVEMENT, min: 0, max: 4 },
      { key: STAMINA, min: 0, max: 8 },
    ]);

    const staminaFirst = optimizeArtifactCombinations(container, candidates, [
      { key: MOVEMENT, weight: 30 },
      { key: STAMINA, weight: 70 },
    ], settings);
    expect(staminaFirst.results[0].indices).toEqual([1, 1]);
  });

  it("derives ranges and results only from exposure-safe combinations", () => {
    const candidates = [
      candidate("Hot and fast", [
        stat(MOVEMENT, "Movement speed", 3),
        stat(TEMPERATURE, "Temperature", 1, false),
      ]),
      candidate("Cool and steady", [stat(MOVEMENT, "Movement speed", 1)]),
    ];

    const result = optimizeArtifactCombinations(container, candidates, [
      { key: MOVEMENT, weight: 100 },
    ], settings);

    expect(result.combinations).toBe(3);
    expect(result.feasibleCombinations).toBe(1);
    expect(result.ranges[0]).toEqual({ key: MOVEMENT, min: 2, max: 2 });
    expect(result.results[0].indices).toEqual([1, 1]);
  });
});
