import manifest from "./generated/artifact-additional-properties.json";
import type { ArtifactConfig, ParsedStat } from "./types";

type ManifestArtifact = {
  mode: "fixed-three" | "selectable";
  properties: ParsedStat[];
};

const artifacts = manifest.artifacts as Record<string, ManifestArtifact>;
export const RUBIK_ID = "9n7z";

export function artifactAdditionalPropertyDefinition(itemId: string) {
  const definition = artifacts[itemId];
  return definition ?? { mode: "none" as const, properties: [] };
}

export function unlockedAdditionalPropertyCount(
  artifact: Pick<ArtifactConfig, "item" | "level" | "additionalPropertyMode">,
) {
  if (artifact.additionalPropertyMode === "none") return 0;
  const thresholds = artifact.item.id === RUBIK_ID ? [1, 5, 10, 15] : [5, 10, 15];
  return thresholds.filter((threshold) => artifact.level >= threshold).length;
}

export function usesAutomaticAdditionalProperties(
  artifact: Pick<ArtifactConfig, "level" | "additionalStats" | "additionalPropertyMode">,
) {
  return artifact.additionalPropertyMode === "fixed-three"
    && artifact.level === 15
    && artifact.additionalStats.length === 3;
}

export function activeAdditionalProperties(artifact: ArtifactConfig) {
  if (usesAutomaticAdditionalProperties(artifact)) return artifact.additionalStats;
  const unlocked = unlockedAdditionalPropertyCount(artifact);
  const selected = new Set(artifact.selectedAdditionalPropertyKeys.slice(0, unlocked));
  return artifact.additionalStats.filter((stat) => selected.has(stat.key));
}
