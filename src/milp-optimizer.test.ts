import loadHighs from "highs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  optimizeArtifactCombinationsMilp,
  type MilpSolver,
} from "./milp-optimizer";
import {
  optimizeArtifactCombinations,
  type OptimizerCandidate,
  type OptimizerContainer,
  type OptimizerSettings,
} from "./optimizer";
import type { ParsedStat } from "./types";

const MOVEMENT = "stalker.artefact_properties.factor.speed_modifier";
const STAMINA = "stalker.artefact_properties.factor.stamina_regeneration_bonus";
const TEMPERATURE = "stalker.artefact_properties.factor.thermal_accumulation";
const CARRY_WEIGHT = "stalker.artefact_properties.factor.max_weight_bonus";

const stat = (key: string, value: number, positive = true): ParsedStat => ({
  key,
  name: key,
  min: value * 0.85,
  max: value,
  positive,
  percentage: key !== TEMPERATURE,
});

const candidate = (name: string, stats: ParsedStat[], price: number | null = null): OptimizerCandidate => ({ name, stats, price });
const container: OptimizerContainer = {
  capacity: 2,
  protection: 0,
  effectiveness: 100,
  stats: [],
};
const settings: OptimizerSettings = {
  quality: 100,
  level: 0,
  rarityIndex: 0,
  allowDuplicates: true,
  constraints: [{ key: TEMPERATURE, minimum: null, maximum: 0.5, scope: "final" }],
  maxTotalPrice: null,
};

describe("MILP artifact optimizer", () => {
  let solver: MilpSolver;

  beforeAll(async () => {
    solver = await loadHighs();
  });

  it("matches brute force ranges, score, and optimal build", async () => {
    const candidates = [
      candidate("Sprinter", [stat(MOVEMENT, 2)]),
      candidate("Charger", [stat(STAMINA, 4)]),
      candidate("Balanced", [stat(MOVEMENT, 1.2), stat(STAMINA, 2.5)]),
    ];
    const objectives = [
      { key: MOVEMENT, weight: 70 },
      { key: STAMINA, weight: 30 },
    ];

    const bruteForce = optimizeArtifactCombinations(container, candidates, objectives, settings);
    const milp = await optimizeArtifactCombinationsMilp(solver, container, candidates, objectives, settings);

    expect(milp.ranges).toEqual(bruteForce.ranges);
    expect(milp.results[0].indices).toEqual(bruteForce.results[0].indices);
    expect(milp.results[0].values).toEqual(bruteForce.results[0].values);
    expect(milp.results[0].score).toBeCloseTo(bruteForce.results[0].score, 10);
    expect(milp.feasibleCombinations).toBeNull();
  });

  it("publishes each proven ranked result before the full search completes", async () => {
    const candidates = [
      candidate("Slow", [stat(MOVEMENT, 1)]),
      candidate("Fast", [stat(MOVEMENT, 2)]),
    ];
    const snapshots: number[] = [];
    const result = await optimizeArtifactCombinationsMilp(
      solver,
      { ...container, capacity: 1 },
      candidates,
      [{ key: MOVEMENT, weight: 1 }],
      settings,
      undefined,
      (partial) => snapshots.push(partial.results.length),
    );

    expect(snapshots).toEqual([1, 2]);
    expect(result.results).toHaveLength(2);
  });

  it("matches brute force for a lower-is-better countering objective", async () => {
    const candidates = [
      candidate("Weak counter", [stat(TEMPERATURE, -1)]),
      candidate("Strong counter", [stat(TEMPERATURE, -2)]),
    ];
    const counterContainer = { ...container, capacity: 1 };
    const objectives = [{ key: TEMPERATURE, weight: 1, direction: -1 as const }];
    const counterSettings = {
      ...settings,
      constraints: [{ key: TEMPERATURE, minimum: null, maximum: -1e-6, scope: "artifact" as const }],
    };

    const bruteForce = optimizeArtifactCombinations(counterContainer, candidates, objectives, counterSettings);
    const milp = await optimizeArtifactCombinationsMilp(solver, counterContainer, candidates, objectives, counterSettings);

    expect(bruteForce.results[0].indices).toEqual([1]);
    expect(milp.results[0].indices).toEqual([1]);
    expect(milp.ranges).toEqual(bruteForce.ranges);
    expect(milp.results[0].score).toBeCloseTo(bruteForce.results[0].score, 10);
  });

  it("excludes carrier carry weight from both exact engines", async () => {
    const carrier = { ...container, capacity: 1, stats: [stat(CARRY_WEIGHT, 35)] };
    const candidates = [candidate("Artifact carry weight", [stat(CARRY_WEIGHT, 2)])];
    const objectives = [{ key: CARRY_WEIGHT, weight: 1 }];
    const carrySettings = {
      ...settings,
      constraints: [{ key: CARRY_WEIGHT, minimum: 1e-6, maximum: null, scope: "artifact" as const }],
    };

    const bruteForce = optimizeArtifactCombinations(carrier, candidates, objectives, carrySettings);
    const milp = await optimizeArtifactCombinationsMilp(solver, carrier, candidates, objectives, carrySettings);

    expect(bruteForce.results[0].values).toEqual([2]);
    expect(milp.results[0].values).toEqual([2]);
  });

  it("matches brute force when rarity variants share a no-duplicate identity", async () => {
    const candidates: OptimizerCandidate[] = [
      { ...candidate("A ordinary", [stat(MOVEMENT, 2)]), identity: "A", quality: 92.5, rarityIndex: 0 },
      { ...candidate("A uncommon", [stat(MOVEMENT, 2)]), identity: "A", quality: 107.5, rarityIndex: 1 },
      { ...candidate("B ordinary", [stat(MOVEMENT, 1)]), identity: "B", quality: 92.5, rarityIndex: 0 },
    ];
    const variantSettings = { ...settings, allowDuplicates: false, constraints: [] };
    const objectives = [{ key: MOVEMENT, weight: 1 }];

    const bruteForce = optimizeArtifactCombinations(container, candidates, objectives, variantSettings);
    const milp = await optimizeArtifactCombinationsMilp(solver, container, candidates, objectives, variantSettings);

    expect(bruteForce.results[0].indices).toEqual([1, 2]);
    expect(milp.results[0].indices).toEqual(bruteForce.results[0].indices);
    expect(milp.results[0].values[0]).toBeCloseTo(3.075);
    expect(milp.combinations).toBe(2);
  });

  it.each([
    ["with duplicate artifacts", true],
    ["without duplicate artifacts", false],
  ])("matches brute force's ordered top ten %s when scores are distinct", async (_, allowDuplicates) => {
    const candidates = [1, 7, 31, 127, 521].map((value, index) =>
      candidate(`Artifact ${index}`, [stat(MOVEMENT, value)]));
    const comparisonContainer = { ...container, capacity: 3 };
    const comparisonSettings = { ...settings, allowDuplicates, constraints: [] };
    const objectives = [{ key: MOVEMENT, weight: 1 }];

    const bruteForce = optimizeArtifactCombinations(
      comparisonContainer,
      candidates,
      objectives,
      comparisonSettings,
    );
    const milp = await optimizeArtifactCombinationsMilp(
      solver,
      comparisonContainer,
      candidates,
      objectives,
      comparisonSettings,
    );

    expect(milp.results).toHaveLength(10);
    expect(milp.results.map((result) => result.indices)).toEqual(
      bruteForce.results.map((result) => result.indices),
    );
    expect(milp.results.map((result) => result.values)).toEqual(
      bruteForce.results.map((result) => result.values),
    );
    milp.results.forEach((result, index) => {
      expect(result.score).toBeCloseTo(bruteForce.results[index].score, 10);
    });
  });

  it("returns ten unique optimal builds when more than ten builds tie", async () => {
    const tiedCandidates = Array.from({ length: 12 }, (_, index) =>
      candidate(`Artifact ${index}`, [stat(MOVEMENT, 1)]));
    const result = await optimizeArtifactCombinationsMilp(
      solver,
      { ...container, capacity: 1 },
      tiedCandidates,
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, allowDuplicates: false },
    );

    expect(result.results).toHaveLength(10);
    expect(new Set(result.results.map((item) => item.indices.join(","))).size).toBe(10);
    expect(result.results.every((item) => item.score === 1)).toBe(true);
  });

  it("matches combined maximum, minimum, and budget constraints", async () => {
    const candidates = [
      candidate("Hot sprinter", [stat(MOVEMENT, 5), stat(TEMPERATURE, 1, false)], 60),
      candidate("Affordable runner", [stat(MOVEMENT, 2), stat(STAMINA, 1)], 20),
      candidate("Counter", [stat(STAMINA, 0.5), stat(TEMPERATURE, -1)], 10),
      candidate("Unknown", [stat(MOVEMENT, 20), stat(STAMINA, 20)]),
    ];
    const objectives = [
      { key: MOVEMENT, weight: 2 },
      { key: STAMINA, weight: 1 },
    ];
    const constrained = {
      ...settings,
      constraints: [
        { key: TEMPERATURE, minimum: null, maximum: 0, scope: "final" as const },
        { key: MOVEMENT, minimum: 5, maximum: null, scope: "artifact" as const },
        { key: STAMINA, minimum: 0.1, maximum: null, scope: "artifact" as const },
      ],
      maxTotalPrice: 70,
    };

    const bruteForce = optimizeArtifactCombinations(container, candidates, objectives, constrained);
    const milp = await optimizeArtifactCombinationsMilp(solver, container, candidates, objectives, constrained);

    expect(milp.ranges).toEqual(bruteForce.ranges);
    expect(milp.results[0].indices).toEqual(bruteForce.results[0].indices);
    expect(milp.results[0].totalPrice).toBe(bruteForce.results[0].totalPrice);
    expect(milp.results[0].score).toBeCloseTo(bruteForce.results[0].score, 10);
  });

  it("does not apply the brute-force combination guard", async () => {
    const candidates = Array.from({ length: 20 }, (_, index) =>
      candidate(`Artifact ${index}`, [stat(MOVEMENT, index + 1)]));
    const result = await optimizeArtifactCombinationsMilp(
      solver,
      { ...container, capacity: 6 },
      candidates,
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, combinationLimit: 5 },
    );

    expect(result.combinations).toBeGreaterThan(100_000);
    expect(result.results[0].indices).toEqual([19, 19, 19, 19, 19, 19]);
  });

  it("inverts inner protection at the same safe boundary as brute force", async () => {
    const protectedContainer = { ...container, capacity: 1, protection: 50 };
    const candidates = [
      candidate("Too hot", [stat(MOVEMENT, 10), stat(TEMPERATURE, 1.2, false)]),
      candidate("Boundary", [stat(MOVEMENT, 3), stat(TEMPERATURE, 1, false)]),
      candidate("Cool", [stat(MOVEMENT, 1)]),
    ];
    const objectives = [{ key: MOVEMENT, weight: 1 }];

    const bruteForce = optimizeArtifactCombinations(protectedContainer, candidates, objectives, settings);
    const milp = await optimizeArtifactCombinationsMilp(solver, protectedContainer, candidates, objectives, settings);

    expect(bruteForce.results[0].indices).toEqual([1]);
    expect(milp.results[0].indices).toEqual(bruteForce.results[0].indices);
    expect(milp.ranges).toEqual(bruteForce.ranges);
  });
});
