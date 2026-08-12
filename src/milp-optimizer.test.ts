import loadHighs from "highs";
import { beforeAll, describe, expect, it } from "vitest";
import { createPersistentMilpSolver } from "./highs-solver";
import {
  MILP_RANGE_TIME_LIMIT_SECONDS,
  MILP_RANK_TIME_LIMIT_SECONDS,
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

const withoutSolveTimes = <T extends { solveSeconds?: number }>(items: T[]) =>
  items.map(({ solveSeconds: _solveSeconds, ...item }) => item);

describe("MILP artifact optimizer", () => {
  let solver: MilpSolver;

  beforeAll(async () => {
    solver = createPersistentMilpSolver(await loadHighs());
  });

  it("uses bounded solves and disables presolve once ranked exclusions exist", async () => {
    const options: Array<Record<string, boolean | number | string>> = [];
    let call = 0;
    const boundedSolver: MilpSolver = {
      solve(_problem, solveOptions) {
        options.push(solveOptions ?? {});
        const selected = call < 2 ? 1 : 0;
        call += 1;
        return {
          Status: "Optimal",
          Columns: {
            x0: { Primal: selected === 0 ? 1 : 0 },
            x1: { Primal: selected === 1 ? 1 : 0 },
          },
          Gap: 0,
          HasFeasibleSolution: true,
        };
      },
    };

    await optimizeArtifactCombinationsMilp(
      boundedSolver,
      { ...container, capacity: 1 },
      [candidate("Slow", [stat(MOVEMENT, 1)]), candidate("Fast", [stat(MOVEMENT, 2)])],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], resultLimit: 2 },
    );

    expect(options.map((item) => item.time_limit)).toEqual([
      MILP_RANGE_TIME_LIMIT_SECONDS,
      MILP_RANK_TIME_LIMIT_SECONDS,
      MILP_RANK_TIME_LIMIT_SECONDS,
    ]);
    expect(options.map((item) => item.presolve)).toEqual(["on", "on", "off"]);
  });

  it("reports bounded range and ranked-build uncertainty after time limits", async () => {
    let call = 0;
    const boundedSolver: MilpSolver = {
      solve() {
        const index = call++;
        if (index === 0) {
          return {
            Status: "Time limit reached",
            Columns: { x0: { Primal: 0 }, x1: { Primal: 1 } },
            Bound: 3,
            Gap: 0.5,
            HasFeasibleSolution: true,
          };
        }
        return {
          Status: "Time limit reached",
          Columns: { x0: { Primal: 0 }, x1: { Primal: 1 } },
          Bound: 1.04,
          Gap: 0.04,
          HasFeasibleSolution: true,
        };
      },
    };

    const result = await optimizeArtifactCombinationsMilp(
      boundedSolver,
      { ...container, capacity: 1 },
      [candidate("Slow", [stat(MOVEMENT, 1)]), candidate("Fast", [stat(MOVEMENT, 2)])],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], resultLimit: 1 },
    );

    expect(result.ranges[0]).toMatchObject({ approximate: true, errorPercent: 50 });
    expect(result.results[0].approximate).toBe(true);
    expect(result.results[0].errorPercent).toBeCloseTo(4, 10);
  });

  it("measures ranked uncertainty against the displayed score including carrier stats", async () => {
    let call = 0;
    const boundedSolver: MilpSolver = {
      solve() {
        const rangeSolve = call++ === 0;
        return {
          Status: rangeSolve ? "Optimal" : "Time limit reached",
          Columns: {
            x0: { Primal: rangeSolve ? 0 : 1 },
            x1: { Primal: rangeSolve ? 1 : 0 },
          },
          Bound: rangeSolve ? 2 : 2 / 3,
          Gap: rangeSolve ? 0 : 1,
          HasFeasibleSolution: true,
        };
      },
    };
    const carrier = {
      ...container,
      capacity: 1,
      stats: [stat(MOVEMENT, 1)],
    };

    const result = await optimizeArtifactCombinationsMilp(
      boundedSolver,
      carrier,
      [candidate("Slow", [stat(MOVEMENT, 1)]), candidate("Fast", [stat(MOVEMENT, 2)])],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], resultLimit: 1 },
    );

    expect(result.results[0].score).toBeCloseTo(2 / 3, 10);
    expect(result.results[0].errorPercent).toBeCloseTo(50, 10);
  });

  it("accepts HiGHS Optimal status despite a tiny residual reported gap", async () => {
    const optimalSolver: MilpSolver = {
      solve() {
        return {
          Status: "Optimal",
          Columns: { x0: { Primal: 1 } },
          Bound: 1,
          Gap: 5e-10,
          HasFeasibleSolution: true,
        };
      },
    };

    const result = await optimizeArtifactCombinationsMilp(
      optimalSolver,
      { ...container, capacity: 1 },
      [candidate("Only", [stat(MOVEMENT, 1)])],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], resultLimit: 1 },
    );

    expect(result.results[0].approximate).toBeUndefined();
  });

  it("rejects a fractional artifact selection before publishing it", async () => {
    const invalidSolver: MilpSolver = {
      solve() {
        return {
          Status: "Optimal",
          Columns: { x0: { Primal: 0.6 }, x1: { Primal: 0.4 } },
          Gap: 0,
          HasFeasibleSolution: true,
        };
      },
    };

    await expect(optimizeArtifactCombinationsMilp(
      invalidSolver,
      { ...container, capacity: 1 },
      [candidate("A", [stat(MOVEMENT, 1)]), candidate("B", [stat(MOVEMENT, 2)])],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], resultLimit: 1 },
    )).rejects.toThrow(/non-integral artifact selection/);
  });

  it("rejects a solver selection that violates the original price cap", async () => {
    const invalidSolver: MilpSolver = {
      solve() {
        return {
          Status: "Optimal",
          Columns: { x0: { Primal: 1 }, x1: { Primal: 0 } },
          Gap: 0,
          HasFeasibleSolution: true,
        };
      },
    };

    await expect(optimizeArtifactCombinationsMilp(
      invalidSolver,
      { ...container, capacity: 1 },
      [candidate("Over budget", [stat(MOVEMENT, 2)], 101), candidate("Affordable", [stat(MOVEMENT, 1)], 50)],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], maxTotalPrice: 100, resultLimit: 1 },
    )).rejects.toThrow(/above the price cap/);
  });

  it("treats a time-limited feasible solution with a zero gap as proven", async () => {
    const boundedSolver: MilpSolver = {
      solve() {
        return {
          Status: "Time limit reached",
          Columns: {
            x0: { Primal: 0 },
            x1: { Primal: 1 },
          },
          Bound: 2,
          Gap: 0,
          HasFeasibleSolution: true,
        };
      },
    };

    const result = await optimizeArtifactCombinationsMilp(
      boundedSolver,
      { ...container, capacity: 1 },
      [candidate("Slow", [stat(MOVEMENT, 1)]), candidate("Fast", [stat(MOVEMENT, 2)])],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], resultLimit: 1 },
    );

    expect(result.ranges[0].approximate).toBeUndefined();
    expect(result.results[0].approximate).toBeUndefined();
  });

  it("propagates a later optimal proof to a no-worse timed-out result", async () => {
    let call = 0;
    const snapshots: Array<Array<boolean | undefined>> = [];
    const boundedSolver: MilpSolver = {
      solve() {
        const index = call++;
        const selected = index <= 1 ? 3 : index === 2 ? 2 : 1;
        return {
          Status: index === 1 || index === 2 ? "Time limit reached" : "Optimal",
          Columns: {
            x0: { Primal: 0 },
            x1: { Primal: selected === 1 ? 1 : 0 },
            x2: { Primal: selected === 2 ? 1 : 0 },
            x3: { Primal: selected === 3 ? 1 : 0 },
          },
          Gap: index === 1 || index === 2 ? 0.2 : 0,
          HasFeasibleSolution: true,
        };
      },
    };

    const result = await optimizeArtifactCombinationsMilp(
      boundedSolver,
      { ...container, capacity: 1 },
      [
        candidate("Slow", [stat(MOVEMENT, 1)]),
        candidate("Third", [stat(MOVEMENT, 2)]),
        candidate("Runner-up", [stat(MOVEMENT, 3)]),
        candidate("Fast", [stat(MOVEMENT, 4)]),
      ],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], resultLimit: 3 },
      undefined,
      (partial) => snapshots.push(partial.results.map((ranked) => ranked.approximate)),
    );

    expect(snapshots).toEqual([
      [true],
      [true, true],
      [undefined, undefined, undefined],
    ]);
    expect(result.results.map((ranked) => ranked.approximate)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("does not propagate proof when the later optimal result scores higher", async () => {
    let call = 0;
    const boundedSolver: MilpSolver = {
      solve() {
        const index = call++;
        const selected = index === 0 || index === 2 ? 2 : 1;
        return {
          Status: index === 1 ? "Time limit reached" : "Optimal",
          Columns: {
            x0: { Primal: 0 },
            x1: { Primal: selected === 1 ? 1 : 0 },
            x2: { Primal: selected === 2 ? 1 : 0 },
          },
          Gap: index === 1 ? 0.5 : 0,
          HasFeasibleSolution: true,
        };
      },
    };

    const result = await optimizeArtifactCombinationsMilp(
      boundedSolver,
      { ...container, capacity: 1 },
      [
        candidate("Slow", [stat(MOVEMENT, 1)]),
        candidate("Premature", [stat(MOVEMENT, 2)]),
        candidate("Fast", [stat(MOVEMENT, 3)]),
      ],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], resultLimit: 2 },
    );

    expect(result.results[0].indices).toEqual([2]);
    expect(result.results[0].approximate).toBeUndefined();
    expect(result.results[1].indices).toEqual([1]);
    expect(result.results[1].approximate).toBe(true);
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

    expect(withoutSolveTimes(milp.ranges)).toEqual(bruteForce.ranges);
    expect(milp.ranges.every((range) => range.solveSeconds! >= 0)).toBe(true);
    expect(milp.results.every((result) => result.solveSeconds! >= 0)).toBe(true);
    expect(milp.results[0].indices).toEqual(bruteForce.results[0].indices);
    expect(milp.results[0].values).toEqual(bruteForce.results[0].values);
    expect(milp.results[0].score).toBeCloseTo(bruteForce.results[0].score, 10);
    expect(milp.feasibleCombinations).toBeNull();
  });

  it("publishes each ranked result before the full search completes", async () => {
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
    expect(withoutSolveTimes(milp.ranges)).toEqual(bruteForce.ranges);
    expect(milp.results[0].score).toBeCloseTo(bruteForce.results[0].score, 10);
  });

  it("matches brute force when a carrier penalty can reverse an enabled objective", async () => {
    const penalizedContainer = {
      ...container,
      capacity: 1,
      stats: [stat(MOVEMENT, -2)],
    };
    const candidates = [
      candidate("Insufficient movement", [stat(MOVEMENT, 1)]),
      candidate("Net positive movement", [stat(MOVEMENT, 3)]),
    ];
    const objectiveSettings = {
      ...settings,
      constraints: [{ key: MOVEMENT, minimum: 1e-6, maximum: null, scope: "artifact" as const }],
    };
    const objectives = [{ key: MOVEMENT, weight: 1 }];

    const bruteForce = optimizeArtifactCombinations(penalizedContainer, candidates, objectives, objectiveSettings);
    const milp = await optimizeArtifactCombinationsMilp(solver, penalizedContainer, candidates, objectives, objectiveSettings);

    expect(bruteForce.results[0]).toMatchObject({ indices: [1], values: [1] });
    expect(milp.results[0]).toMatchObject({ indices: [1], values: [1] });
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

  it("keeps every selected rarity variant in ranked results", async () => {
    const candidates = [
      { ...candidate("A ordinary", [stat(MOVEMENT, 1)], 20), identity: "A", quality: 92.5, rarityIndex: 0 },
      { ...candidate("A uncommon", [stat(MOVEMENT, 2)], 20), identity: "A", quality: 107.5, rarityIndex: 1 },
      { ...candidate("B ordinary", [stat(MOVEMENT, 1.5)], 20), identity: "B", quality: 92.5, rarityIndex: 0 },
    ];
    const result = await optimizeArtifactCombinationsMilp(
      solver,
      { ...container, capacity: 1 },
      candidates,
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], maxTotalPrice: 100, resultLimit: 3 },
    );

    expect(result.combinations).toBe(3);
    expect(result.results.map((entry) => entry.indices)).toEqual([[1], [2], [0]]);
  });

  it("reports an initial MILP progress snapshot before the first solve completes", async () => {
    const progress: Array<{ completed: number; total: number }> = [];
    await optimizeArtifactCombinationsMilp(
      solver,
      { ...container, capacity: 1 },
      [candidate("Fast", [stat(MOVEMENT, 2)])],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], resultLimit: 1 },
      (snapshot) => progress.push(snapshot),
    );

    expect(progress[0]).toEqual({ completed: 0, total: 2 });
    expect(progress.at(-1)).toEqual({ completed: 2, total: 2 });
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

    expect(withoutSolveTimes(milp.ranges)).toEqual(bruteForce.ranges);
    expect(milp.results[0].indices).toEqual(bruteForce.results[0].indices);
    expect(milp.results[0].totalPrice).toBe(bruteForce.results[0].totalPrice);
    expect(milp.results[0].score).toBeCloseTo(bruteForce.results[0].score, 10);
  });

  it("keeps realistic ruble budgets feasible as the maximum increases", async () => {
    const candidates = [
      candidate("Fast", [stat(MOVEMENT, 2), stat(STAMINA, 1)], 180_000),
      candidate("Enduring", [stat(MOVEMENT, 1), stat(STAMINA, 4)], 120_000),
      candidate("Balanced", [stat(MOVEMENT, 1.5), stat(STAMINA, 2.5)], 140_000),
    ];
    const objectives = [
      { key: MOVEMENT, weight: 2 },
      { key: STAMINA, weight: 1 },
    ];
    const budgetSettings = {
      ...settings,
      constraints: [
        { key: MOVEMENT, minimum: 2, maximum: null, scope: "artifact" as const },
        { key: STAMINA, minimum: 2, maximum: null, scope: "artifact" as const },
      ],
    };

    const at300k = await optimizeArtifactCombinationsMilp(
      solver,
      container,
      candidates,
      objectives,
      { ...budgetSettings, maxTotalPrice: 300_000 },
    );
    const at350k = await optimizeArtifactCombinationsMilp(
      solver,
      container,
      candidates,
      objectives,
      { ...budgetSettings, maxTotalPrice: 350_000 },
    );
    const at400k = await optimizeArtifactCombinationsMilp(
      solver,
      container,
      candidates,
      objectives,
      { ...budgetSettings, maxTotalPrice: 400_000 },
    );

    expect(at300k.results.length).toBeGreaterThan(0);
    expect(at350k.results.length).toBeGreaterThan(0);
    expect(at400k.results.length).toBeGreaterThan(0);
    expect(at300k.results.every((result) => result.totalPrice! <= 300_000)).toBe(true);
    expect(at350k.results.every((result) => result.totalPrice! <= 350_000)).toBe(true);
    expect(at400k.results.every((result) => result.totalPrice! <= 400_000)).toBe(true);
  });

  it("normalizes the MILP budget row without rounding candidate prices", async () => {
    const problems: string[] = [];
    const captureSolver: MilpSolver = {
      solve(problem) {
        problems.push(problem);
        return {
          Status: "Optimal",
          Columns: { x0: { Primal: 1 }, x1: { Primal: 0 } },
        };
      },
    };

    await optimizeArtifactCombinationsMilp(
      captureSolver,
      { ...container, capacity: 1 },
      [
        candidate("Half cap", [stat(MOVEMENT, 1)], 175_000),
        candidate("Full cap", [stat(MOVEMENT, 2)], 350_000),
      ],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [], maxTotalPrice: 350_000, resultLimit: 1 },
    );

    expect(problems).not.toHaveLength(0);
    expect(problems.every((problem) => problem.includes("budget: 0.5 x0 + 1 x1 <= 1"))).toBe(true);
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
    expect(withoutSolveTimes(milp.ranges)).toEqual(bruteForce.ranges);
  });
});
