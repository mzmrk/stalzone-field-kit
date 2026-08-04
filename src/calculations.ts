import type {
  ArtifactConfig,
  ContainerData,
  ParsedStat,
  TotalStat,
} from "./types";

export const EXPOSURE_KEYS = new Set([
  "stalker.artefact_properties.factor.radiation_accumulation",
  "stalker.artefact_properties.factor.biological_accumulation",
  "stalker.artefact_properties.factor.psycho_accumulation",
  "stalker.artefact_properties.factor.thermal_accumulation",
  "stalker.artefact_properties.factor.frost_accumulation",
]);

const PROTECTED_EXPOSURE_KEYS = new Set([
  "stalker.artefact_properties.factor.radiation_accumulation",
  "stalker.artefact_properties.factor.biological_accumulation",
  "stalker.artefact_properties.factor.psycho_accumulation",
  "stalker.artefact_properties.factor.thermal_accumulation",
]);

const WARNING_LIMITS: Record<string, number> = {
  "stalker.artefact_properties.factor.radiation_accumulation": 0.5,
  "stalker.artefact_properties.factor.biological_accumulation": 0.5,
  "stalker.artefact_properties.factor.psycho_accumulation": 0.5,
  "stalker.artefact_properties.factor.thermal_accumulation": 0.5,
  "stalker.artefact_properties.factor.frost_accumulation": 1,
};

export const STAT_OPTIONS = [
  ["stalker.artefact_properties.factor.max_weight_bonus", "Carry weight", false],
  ["stalker.artefact_properties.factor.speed_modifier", "Movement speed", true],
  ["stalker.artefact_properties.factor.sprint_speed_modifier", "Running speed", true],
  ["stalker.artefact_properties.factor.stamina_bonus", "Stamina", true],
  ["stalker.artefact_properties.factor.stamina_regeneration_bonus", "Stamina regeneration", true],
  ["stalker.artefact_properties.factor.health_bonus", "Vitality", true],
  ["stalker.artefact_properties.factor.regeneration_bonus", "Health regeneration", true],
  ["stalker.artefact_properties.factor.heal_efficiency", "Healing effectiveness", true],
  ["stalker.artefact_properties.factor.bullet_dmg_factor", "Bullet resistance", false],
  ["stalker.artefact_properties.factor.explosion_dmg_factor", "Explosion protection", false],
  ["stalker.artefact_properties.factor.tear_dmg_factor", "Laceration protection", false],
  ["stalker.artefact_properties.factor.bleeding_accumulation", "Bleeding", false],
  ["stalker.artefact_properties.factor.radiation_accumulation", "Radiation", false],
  ["stalker.artefact_properties.factor.biological_accumulation", "Biological infection", false],
  ["stalker.artefact_properties.factor.psycho_accumulation", "Psy-emissions", false],
  ["stalker.artefact_properties.factor.thermal_accumulation", "Temperature", false],
  ["stalker.artefact_properties.factor.frost_accumulation", "Frost", false],
] as const;

export const RARITY_NAMES = [
  "Ordinary",
  "Uncommon",
  "Special",
  "Rare",
  "Exclusive",
  "Legendary",
  "Unique",
];

export function rarityOptions(quality: number) {
  const boundaries = [100, 115, 130, 145, 160, 175];
  const boundary = boundaries.indexOf(quality);
  if (boundary >= 0) return [boundary, boundary + 1];
  if (quality < 100) return [0];
  return [Math.min(6, Math.floor((quality - 100) / 15) + 1)];
}

function endpoints(stat: ParsedStat) {
  let strongest = Math.max(stat.min, stat.max);
  let weakest = Math.min(stat.min, stat.max);
  if (stat.min <= 0 && stat.max <= 0) {
    strongest = Math.min(stat.min, stat.max);
    weakest = Math.max(stat.min, stat.max);
  }
  return { strongest, weakest };
}

export function calculateStat(
  stat: ParsedStat,
  quality: number,
  level: number,
  rarityIndex: number,
  effectiveness: number,
) {
  const { strongest, weakest } = endpoints(stat);
  const efficiency = EXPOSURE_KEYS.has(stat.key) ? 1 : effectiveness / 100;

  if (stat.positive) {
    return strongest * (quality / 100) * (1 + 0.02 * level) * efficiency;
  }

  let value: number;
  if (quality <= 100) {
    value = weakest + ((strongest - weakest) * quality) / 100;
  } else {
    const inferred = Math.floor((quality - 100) / 15);
    const tier = Math.max(0, Math.min(rarityIndex ?? inferred, 5));
    const tierProgress = Math.max(
      0,
      Math.min(quality - (100 + 15 * tier), 15),
    ) / 15;
    value = strongest * 0.85 + strongest * 0.15 * tierProgress;
  }
  return value * efficiency;
}

export function calculateTotals(
  container: ContainerData | null,
  artifacts: Array<ArtifactConfig | null>,
) {
  if (!container) return { totals: [] as TotalStat[], warnings: [] as TotalStat[], mass: 0 };

  const totals = new Map<string, TotalStat>();
  const add = (
    key: string,
    name: string,
    value: number,
    percentage: boolean,
    harmful = false,
  ) => {
    const current = totals.get(key);
    if (current) {
      current.value += value;
      current.harmful = current.harmful || harmful;
    } else {
      totals.set(key, { key, name, value, percentage, harmful });
    }
  };

  for (const artifact of artifacts) {
    if (!artifact) continue;
    for (const stat of artifact.stats) {
      add(
        stat.key,
        stat.name,
        calculateStat(
          stat,
          artifact.quality,
          artifact.level,
          artifact.rarityIndex,
          container.effectiveness,
        ),
        stat.percentage,
        !stat.positive,
      );
    }
    for (const bonus of artifact.bonuses) {
      add(bonus.key, bonus.name, bonus.value, bonus.percentage, bonus.value > 0 && EXPOSURE_KEYS.has(bonus.key));
    }
  }

  for (const stat of totals.values()) {
    if (PROTECTED_EXPOSURE_KEYS.has(stat.key) && stat.value > 0) {
      stat.value *= 1 - container.protection / 100;
    }
  }

  for (const stat of container.stats) {
    add(stat.key, stat.name, stat.max, stat.percentage, !stat.positive);
  }

  const result = [...totals.values()].filter((stat) => Math.abs(stat.value) > 0.00001);
  const warnings = result.filter(
    (stat) => stat.value > (WARNING_LIMITS[stat.key] ?? Number.POSITIVE_INFINITY),
  );
  const mass = artifacts.reduce((sum, artifact) => sum + (artifact?.weight ?? 0), 0);
  return { totals: result, warnings, mass };
}

export function statCategory(stat: TotalStat) {
  if (EXPOSURE_KEYS.has(stat.key)) return "Exposure";
  if (/speed|stamina|max_weight/.test(stat.key)) return "Mobility & utility";
  if (/health|heal|regeneration/.test(stat.key)) return "Survivability";
  if (/protection|dmg_factor|resistance/.test(stat.key)) return "Protection";
  return "Other effects";
}
