import loadHighsNext from "highs";
import loadHighsStable from "highs-stable";
import { beforeAll, describe, expect, it } from "vitest";
import {
  optimizeArtifactCombinationsMilp,
  type MilpSolver,
} from "./milp-optimizer";
import {
  optimizeArtifactCombinations,
  type OptimizerCandidate,
  type OptimizerContainer,
  type OptimizerObjective,
  type OptimizerSearchResult,
  type OptimizerSettings,
} from "./optimizer";
import type { ParsedStat } from "./types";

const MOVEMENT = "stalker.artefact_properties.factor.speed_modifier";
const STAMINA_REGEN = "stalker.artefact_properties.factor.stamina_regeneration_bonus";
const BULLET_RESISTANCE = "stalker.artefact_properties.factor.bullet_dmg_factor";
const TEMPERATURE = "stalker.artefact_properties.factor.thermal_accumulation";

const stat = (key: string, value: number, positive = true): ParsedStat => ({
  key,
  name: key,
  min: value * 0.85,
  max: value,
  positive,
  percentage: key !== TEMPERATURE,
});

const candidate = (
  name: string,
  stats: ParsedStat[],
  price: number,
  quality = 107.5,
): OptimizerCandidate => ({ name, stats, price, quality, rarityIndex: 1, identity: name });

const container: OptimizerContainer = {
  capacity: 3,
  protection: 60,
  effectiveness: 78.5,
  stats: [],
};

const objectives: OptimizerObjective[] = [
  { key: MOVEMENT, weight: 2 },
  { key: STAMINA_REGEN, weight: 1 },
  { key: BULLET_RESISTANCE, weight: 1 },
];

const settings: OptimizerSettings = {
  quality: 100,
  level: 15,
  rarityIndex: 0,
  allowDuplicates: true,
  constraints: [
    { key: MOVEMENT, minimum: 0.5, maximum: null, scope: "artifact" },
    { key: STAMINA_REGEN, minimum: 0.5, maximum: null, scope: "artifact" },
    { key: TEMPERATURE, minimum: null, maximum: 0, scope: "final" },
  ],
  maxTotalPrice: 260_000,
  resultLimit: 5,
};

function expectEquivalent(actual: OptimizerSearchResult, expected: OptimizerSearchResult) {
  expect(actual.combinations).toBe(expected.combinations);
  expect(actual.ranges.map((range) => range.key)).toEqual(expected.ranges.map((range) => range.key));
  actual.ranges.forEach((range, index) => {
    expect(range.min).toBeCloseTo(expected.ranges[index].min, 10);
    expect(range.max).toBeCloseTo(expected.ranges[index].max, 10);
  });
  expect(actual.results.map((result) => result.indices)).toEqual(
    expected.results.map((result) => result.indices),
  );
  actual.results.forEach((result, index) => {
    result.values.forEach((value, valueIndex) => {
      expect(value).toBeCloseTo(expected.results[index].values[valueIndex], 10);
    });
    expect(result.score).toBeCloseTo(expected.results[index].score, 10);
    expect(result.totalPrice).toBe(expected.results[index].totalPrice);
  });
}

describe("HiGHS stable-to-next migration", () => {
  let stable: MilpSolver;
  let next: MilpSolver;

  beforeAll(async () => {
    [stable, next] = await Promise.all([loadHighsStable(), loadHighsNext()]);
  });

  it("preserves the one-shot MILP API and integer optimum", () => {
    const problem = `Maximize
 objective: 7 fast + 4 steady
Subject To
 slots: fast + steady <= 5
 budget: 3 fast + steady <= 9
Bounds
 0 <= fast <= 5
 0 <= steady <= 5
Generals
 fast steady
End`;

    const stableResult = stable.solve(problem, { output_flag: false });
    const nextResult = next.solve(problem, { output_flag: false });

    for (const result of [stableResult, nextResult]) {
      expect(result.Status).toBe("Optimal");
      expect((result as typeof result & { ObjectiveValue: number }).ObjectiveValue).toBeCloseTo(26, 10);
      expect((result.Columns.fast as { Primal: number }).Primal).toBeCloseTo(2, 10);
      expect((result.Columns.steady as { Primal: number }).Primal).toBeCloseTo(3, 10);
    }
    expect((nextResult.Columns.fast as { Primal: number }).Primal).toBeCloseTo(
      (stableResult.Columns.fast as { Primal: number }).Primal,
      10,
    );
    expect((nextResult.Columns.steady as { Primal: number }).Primal).toBeCloseTo(
      (stableResult.Columns.steady as { Primal: number }).Primal,
      10,
    );
  });

  it("matches brute force on a calculator-shaped weighted and constrained search", async () => {
    const candidates = [
      candidate("Hot sprinter", [stat(MOVEMENT, 3), stat(STAMINA_REGEN, 0.4), stat(TEMPERATURE, 1.1, false)], 110_000),
      candidate("Endurance", [stat(MOVEMENT, 0.4), stat(STAMINA_REGEN, 4), stat(TEMPERATURE, 0.35, false)], 75_000),
      candidate("Insulator", [stat(BULLET_RESISTANCE, 3), stat(STAMINA_REGEN, 0.3), stat(TEMPERATURE, -1.5, false)], 55_000),
      candidate("Balanced", [stat(MOVEMENT, 1.4), stat(STAMINA_REGEN, 2), stat(BULLET_RESISTANCE, 1.2)], 90_000, 92.5),
    ];

    const bruteForce = optimizeArtifactCombinations(container, candidates, objectives, settings);
    const stableResult = await optimizeArtifactCombinationsMilp(stable, container, candidates, objectives, settings);
    const nextResult = await optimizeArtifactCombinationsMilp(next, container, candidates, objectives, settings);

    expect(bruteForce.results).toHaveLength(5);
    expectEquivalent(stableResult, bruteForce);
    expectEquivalent(nextResult, bruteForce);
  });

  it("treats different selections as equivalent when the optimum is tied", async () => {
    const tiedCandidates = Array.from({ length: 4 }, (_, index) =>
      candidate(`Equivalent ${index}`, [stat(MOVEMENT, 1)], 10_000));
    const tiedContainer = { ...container, capacity: 1 };
    const tiedSettings = {
      ...settings,
      constraints: [],
      maxTotalPrice: null,
      resultLimit: 3,
    };
    const tiedObjectives = [{ key: MOVEMENT, weight: 1 }];

    const stableResult = await optimizeArtifactCombinationsMilp(
      stable,
      tiedContainer,
      tiedCandidates,
      tiedObjectives,
      tiedSettings,
    );
    const nextResult = await optimizeArtifactCombinationsMilp(
      next,
      tiedContainer,
      tiedCandidates,
      tiedObjectives,
      tiedSettings,
    );

    expect(nextResult.ranges[0].min).toBeCloseTo(stableResult.ranges[0].min, 10);
    expect(nextResult.ranges[0].max).toBeCloseTo(stableResult.ranges[0].max, 10);
    for (const result of [stableResult, nextResult]) {
      expect(result.ranges[0].key).toBe(MOVEMENT);
      expect(result.ranges[0].min).toBeCloseTo(result.ranges[0].max, 10);
      expect(result.results).toHaveLength(3);
      expect(new Set(result.results.map((entry) => entry.indices.join(","))).size).toBe(3);
      expect(result.results.every((entry) => entry.score === 1)).toBe(true);
    }
  });
});
