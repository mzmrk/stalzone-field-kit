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
const CARRY_WEIGHT = "stalker.artefact_properties.factor.max_weight_bonus";
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
  noNegativeEffects: false,
  requireAllObjectives: false,
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

  it("accepts a harmful property only when its final net value is fully countered", () => {
    const candidates = [
      candidate("Hot and fast", [
        stat(MOVEMENT, "Movement speed", 3),
        stat(TEMPERATURE, "Temperature", 1, false),
      ]),
      candidate("Mild", [
        stat(MOVEMENT, "Movement speed", 2),
        stat(TEMPERATURE, "Temperature", 0.2, false),
      ]),
      candidate("Counter", [stat(TEMPERATURE, "Temperature", -1)]),
    ];

    const result = optimizeArtifactCombinations(container, candidates, [
      { key: MOVEMENT, weight: 100 },
    ], { ...settings, safeOnly: false, noNegativeEffects: true });

    expect(result.feasibleCombinations).toBe(3);
    expect(result.results[0].indices).toEqual([0, 2]);
    expect(result.results[0].values[0]).toBe(3);
  });

  it("can require every positive-weight objective to finish above zero", () => {
    const candidates = [
      candidate("Sprinter", [stat(MOVEMENT, "Movement speed", 5)]),
      candidate("Balanced", [
        stat(MOVEMENT, "Movement speed", 1),
        stat(STAMINA, "Stamina regeneration", 1),
      ]),
    ];
    const objectives = [
      { key: MOVEMENT, weight: 99 },
      { key: STAMINA, weight: 1 },
    ];

    const optional = optimizeArtifactCombinations(container, candidates, objectives, settings);
    expect(optional.results[0].indices).toEqual([0, 0]);
    expect(optional.results[0].values).toEqual([10, 0]);

    const required = optimizeArtifactCombinations(container, candidates, objectives, {
      ...settings,
      requireAllObjectives: true,
    });
    expect(required.feasibleCombinations).toBe(2);
    expect(required.results[0].indices).toEqual([0, 1]);
    expect(required.results.every((result) => result.values.every((value) => value > 0))).toBe(true);
  });

  it("does not let a carrier stat satisfy a required artifact objective", () => {
    const carrier: OptimizerContainer = {
      capacity: 1,
      protection: 0,
      effectiveness: 100,
      stats: [stat(CARRY_WEIGHT, "Carry weight", 35)],
    };
    const candidates = [
      candidate("No carry weight", [stat(MOVEMENT, "Movement speed", 1)]),
      candidate("Artifact carry weight", [stat(CARRY_WEIGHT, "Carry weight", 2)]),
    ];

    const result = optimizeArtifactCombinations(carrier, candidates, [
      { key: CARRY_WEIGHT, weight: 100 },
    ], { ...settings, requireAllObjectives: true });

    expect(result.feasibleCombinations).toBe(1);
    expect(result.results[0].indices).toEqual([1]);
    expect(result.results[0].values).toEqual([37]);
  });
});
