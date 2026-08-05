import { describe, expect, it } from "vitest";
import {
  combinationCount,
  candidateCombinationCount,
  groupedCombinationCount,
  harmfulEffectConstraint,
  OPTIMIZER_HARMFUL_OPTIONS,
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

  it("does not let a carrier stat satisfy an artifact minimum", () => {
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
    expect(result.results[0].values).toEqual([37]);
  });

  it("filters combinations by total median price before deriving feasible ranges", () => {
    const candidates = [
      candidate("Fast and expensive", [stat(MOVEMENT, "Movement speed", 5)], 60),
      candidate("Affordable", [stat(MOVEMENT, "Movement speed", 2)], 20),
      candidate("Unknown price", [stat(MOVEMENT, "Movement speed", 10)]),
    ];

    const result = optimizeArtifactCombinations(container, candidates, [
      { key: MOVEMENT, weight: 100 },
    ], { ...settings, maxTotalPrice: 50 });

    expect(result.feasibleCombinations).toBe(1);
    expect(result.ranges).toEqual([{ key: MOVEMENT, min: 4, max: 4 }]);
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
