import { describe, expect, it } from "vitest";
import manifest from "./generated/artifact-additional-properties.json";
import {
  activeAdditionalProperties,
  artifactAdditionalPropertyDefinition,
  unlockedAdditionalPropertyCount,
  usesAutomaticAdditionalProperties,
} from "./artifact-properties";
import type { ArtifactConfig } from "./types";

function configuredArtifact(
  itemId: string,
  level: number,
  selectedAdditionalPropertyKeys: string[] = [],
) {
  const definition = artifactAdditionalPropertyDefinition(itemId);
  return {
    item: { id: itemId },
    level,
    additionalStats: definition.properties,
    additionalPropertyMode: definition.mode,
    selectedAdditionalPropertyKeys,
  } as ArtifactConfig;
}

describe("artifact additional properties", () => {
  it("contains three fixed properties for every normal EXBO artifact and the exceptional Rubik pool", () => {
    const entries = Object.entries(manifest.artifacts);
    expect(entries).toHaveLength(103);
    expect(entries.filter(([, artifact]) => artifact.mode === "fixed-three")).toHaveLength(102);
    expect(manifest.artifacts["9n7z"].mode).toBe("selectable");
    expect(manifest.artifacts["9n7z"].properties).toHaveLength(24);
    expect(entries.every(([, artifact]) => new Set(artifact.properties.map((stat) => stat.key)).size === artifact.properties.length)).toBe(true);
  });

  it("keeps +5 and +10 choices explicit and activates all three normal properties at +15", () => {
    const definition = artifactAdditionalPropertyDefinition("ljn2");
    const keys = definition.properties.map((stat) => stat.key);

    const plusFive = configuredArtifact("ljn2", 5, [keys[1]]);
    expect(unlockedAdditionalPropertyCount(plusFive)).toBe(1);
    expect(activeAdditionalProperties(plusFive).map((stat) => stat.key)).toEqual([keys[1]]);

    const plusTen = configuredArtifact("ljn2", 10, [keys[0], keys[2]]);
    expect(unlockedAdditionalPropertyCount(plusTen)).toBe(2);
    expect(activeAdditionalProperties(plusTen).map((stat) => stat.key).sort()).toEqual([keys[0], keys[2]].sort());

    const plusFifteen = configuredArtifact("ljn2", 15);
    expect(usesAutomaticAdditionalProperties(plusFifteen)).toBe(true);
    expect(activeAdditionalProperties(plusFifteen)).toEqual(definition.properties);
  });

  it("keeps Rubik explicit at every level and unlocks its first slot at +1", () => {
    const definition = artifactAdditionalPropertyDefinition("9n7z");
    const rubik = configuredArtifact("9n7z", 15, definition.properties.slice(0, 4).map((stat) => stat.key));

    expect(unlockedAdditionalPropertyCount(configuredArtifact("9n7z", 1))).toBe(1);
    expect(unlockedAdditionalPropertyCount(rubik)).toBe(4);
    expect(usesAutomaticAdditionalProperties(rubik)).toBe(false);
    expect(activeAdditionalProperties(rubik)).toHaveLength(4);
  });
});
