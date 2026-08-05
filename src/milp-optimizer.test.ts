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
  safeOnly: true,
  noNegativeEffects: false,
  requireAllObjectives: false,
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

  it("matches combined safety, counter-effect, objective, and budget constraints", async () => {
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
      noNegativeEffects: true,
      requireAllObjectives: true,
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
