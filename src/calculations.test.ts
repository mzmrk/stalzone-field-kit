import { describe, expect, it } from "vitest";
import { calculateStat, calculateTotals, RARITY_MIDPOINT_QUALITIES, rarityOptions } from "./calculations";
import type { ArtifactConfig, ContainerData, ParsedStat } from "./types";

const beneficial: ParsedStat = {
  key: "stalker.artefact_properties.factor.speed_modifier",
  name: "Movement speed",
  min: 0.85,
  max: 1,
  positive: true,
  percentage: true,
};

describe("artifact calculations", () => {
  it("uses the midpoint of every rarity band for unstudied optimizer estimates", () => {
    expect(RARITY_MIDPOINT_QUALITIES).toEqual([92.5, 107.5, 122.5, 137.5, 152.5, 167.5, 182.5]);
  });

  it("applies quality, upgrades, and container effectiveness", () => {
    expect(calculateStat(beneficial, 120, 10, 1, 110)).toBeCloseTo(1.584);
  });

  it("does not apply effectiveness to exposure", () => {
    const exposure = { ...beneficial, key: "stalker.artefact_properties.factor.radiation_accumulation" };
    expect(calculateStat(exposure, 100, 0, 0, 150)).toBeCloseTo(1);
  });

  it("scales an ordinary harmful property directly by artifact quality", () => {
    const temperature: ParsedStat = {
      key: "stalker.artefact_properties.factor.thermal_accumulation",
      name: "Temperature",
      min: 1.0625,
      max: 1.25,
      positive: false,
      percentage: false,
    };

    expect(calculateStat(temperature, 92.18, 0, 0, 100)).toBeCloseTo(1.15225);
  });

  it("offers both rarities at a quality boundary", () => {
    expect(rarityOptions(115)).toEqual([1, 2]);
  });

  it("resets a harmful property at the start of a higher rarity tier", () => {
    const harmful = {
      ...beneficial,
      key: "stalker.artefact_properties.factor.frost_accumulation",
      positive: false,
      percentage: false,
    };
    expect(calculateStat(harmful, 115, 0, 1, 100)).toBeCloseTo(0.85);
  });

  it("applies inner protection to remaining harmful exposure", () => {
    const exposure: ParsedStat = {
      key: "stalker.artefact_properties.factor.radiation_accumulation",
      name: "Radiation",
      min: 0.85,
      max: 1,
      positive: false,
      percentage: false,
    };
    const container = {
      protection: 60,
      effectiveness: 100,
      stats: [],
    } as unknown as ContainerData;
    const artifact = {
      quality: 100,
      level: 0,
      rarityIndex: 0,
      stats: [exposure],
      bonuses: [],
      weight: 0,
    } as unknown as ArtifactConfig;
    const result = calculateTotals(container, [artifact]);
    expect(result.totals[0].value).toBeCloseTo(0.4);
    expect(result.warnings).toHaveLength(0);
  });

  it("sums counter artifacts before applying inner protection", () => {
    const harmful: ParsedStat = {
      key: "stalker.artefact_properties.factor.radiation_accumulation",
      name: "Radiation",
      min: 1.7,
      max: 2,
      positive: false,
      percentage: false,
    };
    const counter: ParsedStat = {
      ...harmful,
      min: -1.7,
      max: -2,
      positive: true,
    };
    const container = {
      protection: 50,
      effectiveness: 120,
      stats: [],
    } as unknown as ContainerData;
    const makeArtifact = (stats: ParsedStat[]) => ({
      quality: 100,
      level: 0,
      rarityIndex: 0,
      stats,
      bonuses: [],
      weight: 0,
    }) as unknown as ArtifactConfig;
    const result = calculateTotals(container, [makeArtifact([harmful]), makeArtifact([counter])]);
    expect(result.totals).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("excludes carrier carry weight while retaining artifact bonuses and other carrier stats", () => {
    const containerStat: ParsedStat = {
      key: "stalker.artefact_properties.factor.max_weight_bonus",
      name: "Carry weight",
      min: 20,
      max: 20,
      positive: true,
      percentage: false,
    };
    const movementStat: ParsedStat = {
      key: "stalker.artefact_properties.factor.speed_modifier",
      name: "Movement speed",
      min: 1,
      max: 1,
      positive: true,
      percentage: true,
    };
    const container = {
      protection: 0,
      effectiveness: 100,
      stats: [containerStat, movementStat],
    } as unknown as ContainerData;
    const artifact = {
      quality: 100,
      level: 5,
      rarityIndex: 0,
      stats: [],
      bonuses: [{
        id: "bonus",
        key: containerStat.key,
        name: containerStat.name,
        value: 3.5,
        percentage: false,
      }],
      weight: 0.4,
    } as unknown as ArtifactConfig;
    const result = calculateTotals(container, [artifact]);
    expect(result.totals.find((stat) => stat.key === containerStat.key)?.value).toBeCloseTo(3.5);
    expect(result.totals.find((stat) => stat.key === movementStat.key)?.value).toBeCloseTo(1);
    expect(result.mass).toBeCloseTo(0.4);
  });

  it("warns only after the published exposure threshold is exceeded", () => {
    const exposure: ParsedStat = {
      key: "stalker.artefact_properties.factor.radiation_accumulation",
      name: "Radiation",
      min: 0.425,
      max: 0.5,
      positive: false,
      percentage: false,
    };
    const container = { protection: 0, effectiveness: 100, stats: [] } as unknown as ContainerData;
    const artifact = {
      quality: 100,
      level: 0,
      rarityIndex: 0,
      stats: [exposure],
      bonuses: [],
      weight: 0,
    } as unknown as ArtifactConfig;
    expect(calculateTotals(container, [artifact]).warnings).toHaveLength(0);
    artifact.stats = [{ ...exposure, min: 0.4335, max: 0.51 }];
    expect(calculateTotals(container, [artifact]).warnings).toHaveLength(1);
  });
});
