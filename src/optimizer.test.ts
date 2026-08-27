import { describe, expect, it } from "vitest";
import {
  BRUTE_FORCE_COMBINATION_LIMIT,
  combinationCount,
  candidateCombinationCount,
  groupedCombinationCount,
  harmfulEffectConstraint,
  OPTIMIZER_HARMFUL_OPTIONS,
  OPTIMIZER_STAT_OPTIONS,
  optimizerEngineFor,
  optimizeArtifactCombinations,
  requiredPositiveEffectConstraint,
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

const candidate = (name: string, stats: ParsedStat[], price: number | null = null): OptimizerCandidate => ({ name, stats, price });
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
  constraints: [{ key: TEMPERATURE, minimum: null, maximum: 0.5, scope: "final" as const }],
  maxTotalPrice: null,
};

describe("artifact optimizer", () => {
  it("orders positive filters by broad general-use demand", () => {
    expect(OPTIMIZER_STAT_OPTIONS.map((option) => option[1])).toEqual([
      "Movement speed",
      "Bullet resistance",
      "Vitality",
      "Periodic healing",
      "Running speed",
      "Stamina regeneration",
      "Healing effectiveness",
      "Health regeneration",
      "Carry weight",
      "Stamina",
      "Laceration protection",
      "Explosion protection",
      "Bleeding protection",
      "Stability",
      "Reaction to burns",
      "Reaction to chemical burns",
      "Reaction to electricity",
      "Reaction to laceration",
      "Electricity resistance",
      "Fire resistance",
      "Bioinfection protection",
      "Psy-emission protection",
      "Radiation protection",
      "Thermal protection",
      "Radiation countering",
      "Biological infection countering",
      "Psy-emission countering",
      "Temperature countering",
      "Bleeding countering",
      "Burning countering",
      "Recoil reduction",
      "Sway reduction",
    ]);
    expect(OPTIMIZER_STAT_OPTIONS).toHaveLength(32);
    expect(new Set(OPTIMIZER_STAT_OPTIONS.map((option) => option[0])).size).toBe(32);
    expect(OPTIMIZER_STAT_OPTIONS.filter((option) => option[3] === -1).map((option) => option[1])).toEqual([
      "Radiation countering",
      "Biological infection countering",
      "Psy-emission countering",
      "Temperature countering",
      "Bleeding countering",
      "Burning countering",
      "Recoil reduction",
      "Sway reduction",
    ]);

    expect(OPTIMIZER_STAT_OPTIONS.find((option) => option[1] === "Sway reduction")).toEqual([
      "stalker.artefact_properties.factor.wiggle_bonus",
      "Sway reduction",
      true,
      -1,
    ]);
  });

  it("covers every harmful property published by the current artifact catalog", () => {
    expect(OPTIMIZER_HARMFUL_OPTIONS.map((option) => option.name)).toEqual([
      "Radiation",
      "Biological infection",
      "Psy-emissions",
      "Temperature",
      "Frost",
      "Recoil",
      "Vitality",
      "Healing effectiveness",
      "Bullet resistance",
      "Bleeding protection",
      "Reaction to burns",
      "Movement speed",
      "Running speed",
    ]);
  });

  it("translates accepted harm into direction-aware final-build constraints", () => {
    const radiation = OPTIMIZER_HARMFUL_OPTIONS.find((option) => option.name === "Radiation")!;
    const vitality = OPTIMIZER_HARMFUL_OPTIONS.find((option) => option.name === "Vitality")!;

    expect(harmfulEffectConstraint(radiation, "safe", null)).toEqual({
      key: radiation.key,
      minimum: null,
      maximum: 0.5,
      scope: "final",
    });
    expect(harmfulEffectConstraint(radiation, "strict", null)?.maximum).toBe(0);
    expect(harmfulEffectConstraint(vitality, "strict", null)).toEqual({
      key: vitality.key,
      minimum: -0,
      maximum: null,
      scope: "final",
    });
    expect(harmfulEffectConstraint(vitality, "custom", 5)?.minimum).toBe(-5);
    expect(harmfulEffectConstraint(vitality, "allow", null)).toBeNull();
  });

  it("counts canonical combinations without generating slot permutations", () => {
    expect(combinationCount(103, 4, true)).toBe(4_967_690);
    expect(combinationCount(103, 4, false)).toBe(4_421_275);
    const exactLargeCount = 20_688_443_967_788_245n;
    const candidates = Array.from({ length: 103 }, (_, artifactIndex) =>
      Array.from({ length: 7 }, (_, rarityIndex) => ({
        ...candidate(`${artifactIndex}-${rarityIndex}`, []),
        identity: `artifact-${artifactIndex}`,
      }))).flat();
    expect(groupedCombinationCount(103, 7, 7, true)).toBe(exactLargeCount);
    expect(candidateCombinationCount(candidates, 7, true)).toBe(exactLargeCount);
    expect(optimizerEngineFor(exactLargeCount)).toBe("milp");
  });

  it("selects MILP only when the brute-force combination limit is exceeded", () => {
    expect(optimizerEngineFor(BRUTE_FORCE_COMBINATION_LIMIT - 1)).toBe("brute-force");
    expect(optimizerEngineFor(BRUTE_FORCE_COMBINATION_LIMIT)).toBe("brute-force");
    expect(optimizerEngineFor(BRUTE_FORCE_COMBINATION_LIMIT + 1)).toBe("milp");
  });

  it("requires an enabled positive effect to be present on the selected artifacts", () => {
    const required = requiredPositiveEffectConstraint(MOVEMENT, null);
    const result = optimizeArtifactCombinations(
      { ...container, capacity: 1 },
      [candidate("No movement", []), candidate("Movement", [stat(MOVEMENT, "Movement", 1)])],
      [{ key: MOVEMENT, weight: 1 }],
      { ...settings, constraints: [required] },
    );

    expect(required).toEqual({
      key: MOVEMENT,
      minimum: 1e-6,
      maximum: null,
      scope: "artifact",
    });
    expect(result.results.map((entry) => entry.indices)).toEqual([[1]]);
    expect(requiredPositiveEffectConstraint(MOVEMENT, 2).minimum).toBe(2);
    expect(requiredPositiveEffectConstraint(TEMPERATURE, null, -1)).toEqual({
      key: TEMPERATURE,
      minimum: null,
      maximum: -1e-6,
      scope: "artifact",
    });
  });

  it("rejects an objective whose carrier penalty makes the final value harmful", () => {
    const penalizedContainer = {
      ...container,
      capacity: 1,
      stats: [stat(MOVEMENT, "Movement penalty", -2)],
    };
    const candidates = [
      candidate("Insufficient movement", [stat(MOVEMENT, "Movement", 1)]),
      candidate("Net positive movement", [stat(MOVEMENT, "Movement", 3)]),
    ];
    const objectiveSettings = {
      ...settings,
      constraints: [requiredPositiveEffectConstraint(MOVEMENT, null)],
    };

    const result = optimizeArtifactCombinations(
      penalizedContainer,
      candidates,
      [{ key: MOVEMENT, weight: 1 }],
      objectiveSettings,
    );

    expect(result.feasibleCombinations).toBe(1);
    expect(result.results[0]).toMatchObject({ indices: [1], values: [1] });
  });

  it("ranks stronger negative counter-effects above weaker ones", () => {
    const candidates = [
      candidate("Weak counter", [stat(TEMPERATURE, "Temperature", -1)]),
      candidate("Strong counter", [stat(TEMPERATURE, "Temperature", -2)]),
    ];
    const result = optimizeArtifactCombinations(
      { ...container, capacity: 1 },
      candidates,
      [{ key: TEMPERATURE, weight: 1, direction: -1 }],
      {
        ...settings,
        constraints: [requiredPositiveEffectConstraint(TEMPERATURE, null, -1)],
      },
    );

    expect(result.ranges).toEqual([{ key: TEMPERATURE, min: -2, max: 0 }]);
    expect(result.results[0].indices).toEqual([1]);
    expect(result.results[0].score).toBe(1);
    expect(result.results[1].score).toBe(0.5);
  });

  it("counts rarity variants while keeping artifact identities unique", () => {
    const candidates = [
      { ...candidate("A ordinary", []), identity: "A" },
      { ...candidate("A uncommon", []), identity: "A" },
      { ...candidate("B ordinary", []), identity: "B" },
      { ...candidate("B uncommon", []), identity: "B" },
    ];
    expect(groupedCombinationCount(2, 2, 2, false)).toBe(4);
    expect(groupedCombinationCount(2, 2, 2, true)).toBe(10);
    expect(candidateCombinationCount(candidates, 2, false)).toBe(4);
  });

  it("uses candidate-specific rarity quality and rejects two variants of one artifact", () => {
    const candidates: OptimizerCandidate[] = [
      { ...candidate("A ordinary", [stat(MOVEMENT, "Movement", 2)]), identity: "A", quality: 92.5, rarityIndex: 0 },
      { ...candidate("A uncommon", [stat(MOVEMENT, "Movement", 2)]), identity: "A", quality: 107.5, rarityIndex: 1 },
      { ...candidate("B ordinary", [stat(MOVEMENT, "Movement", 1)]), identity: "B", quality: 92.5, rarityIndex: 0 },
    ];
    const result = optimizeArtifactCombinations(container, candidates, [{ key: MOVEMENT, weight: 1 }], {
      ...settings,
      allowDuplicates: false,
      constraints: [],
    });

    expect(result.combinations).toBe(2);
    expect(result.feasibleCombinations).toBe(2);
    expect(result.results[0].indices).toEqual([1, 2]);
    expect(result.results[0].values[0]).toBeCloseTo(3.075);
  });

  it("rejects a search before enumeration when it exceeds the configured limit", () => {
    expect(() => optimizeArtifactCombinations(container, [
      candidate("A", []),
      candidate("B", []),
      candidate("C", []),
    ], [{ key: MOVEMENT, weight: 100 }], { ...settings, combinationLimit: 5 }))
      .toThrow(/6 combinations.*limit is 5/);
  });

  it("normalizes from neutral zero to each best value and follows objective weights", () => {
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
    expect(movementFirst.results.find((result) => result.indices.join(",") === "0,1")?.score).toBe(0.5);

    const staminaFirst = optimizeArtifactCombinations(container, candidates, [
      { key: MOVEMENT, weight: 30 },
      { key: STAMINA, weight: 70 },
    ], settings);
    expect(staminaFirst.results[0].indices).toEqual([1, 1]);
  });

  it("gives a minimum-qualified positive value proportional credit from zero", () => {
    const result = optimizeArtifactCombinations(
      { ...container, capacity: 1 },
      [
        candidate("Minimum", [stat(MOVEMENT, "Movement speed", 2)]),
        candidate("Best", [stat(MOVEMENT, "Movement speed", 4)]),
      ],
      [{ key: MOVEMENT, weight: 1 }],
      {
        ...settings,
        constraints: [{ key: MOVEMENT, minimum: 2, maximum: null, scope: "artifact" }],
      },
    );

    expect(result.ranges).toEqual([{ key: MOVEMENT, min: 0, max: 4 }]);
    expect(result.results.map((entry) => entry.score)).toEqual([1, 0.5]);
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
    expect(result.ranges[0]).toEqual({ key: MOVEMENT, min: 0, max: 2 });
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
    ], {
      ...settings,
      constraints: [{ key: TEMPERATURE, minimum: null, maximum: 0, scope: "final" }],
    });

    expect(result.feasibleCombinations).toBe(3);
    expect(result.results[0].indices).toEqual([0, 2]);
    expect(result.results[0].values[0]).toBe(3);
  });

  it("enforces independent artifact minimums for positive effects", () => {
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
      constraints: [
        { key: MOVEMENT, minimum: 0.000001, maximum: null, scope: "artifact" },
        { key: STAMINA, minimum: 0.000001, maximum: null, scope: "artifact" },
      ],
    });
    expect(required.feasibleCombinations).toBe(2);
    expect(required.results[0].indices).toEqual([0, 1]);
    expect(required.results.every((result) => result.values.every((value) => value > 0))).toBe(true);
  });

  it("excludes carrier carry weight from objectives and artifact minimums", () => {
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
    ], {
      ...settings,
      constraints: [{ key: CARRY_WEIGHT, minimum: 0.000001, maximum: null, scope: "artifact" }],
    });

    expect(result.feasibleCombinations).toBe(1);
    expect(result.results[0].indices).toEqual([1]);
    expect(result.results[0].values).toEqual([2]);
  });

  it("filters combinations by total median price before deriving best values", () => {
    const candidates = [
      candidate("Fast and expensive", [stat(MOVEMENT, "Movement speed", 5)], 60),
      candidate("Affordable", [stat(MOVEMENT, "Movement speed", 2)], 20),
      candidate("Unknown price", [stat(MOVEMENT, "Movement speed", 10)]),
    ];

    const result = optimizeArtifactCombinations(container, candidates, [
      { key: MOVEMENT, weight: 100 },
    ], { ...settings, maxTotalPrice: 50 });

    expect(result.feasibleCombinations).toBe(1);
    expect(result.ranges).toEqual([{ key: MOVEMENT, min: 0, max: 4 }]);
    expect(result.results[0]).toMatchObject({ indices: [1, 1], totalPrice: 40 });
  });

  it("keeps unknown-price candidates eligible when no budget is set", () => {
    const result = optimizeArtifactCombinations({ ...container, capacity: 1 }, [
      candidate("Known", [stat(MOVEMENT, "Movement speed", 1)], 10),
      candidate("Unknown", [stat(MOVEMENT, "Movement speed", 2)]),
    ], [{ key: MOVEMENT, weight: 100 }], settings);

    expect(result.results[0]).toMatchObject({ indices: [1], totalPrice: null });
  });
});
