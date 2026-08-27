import {
  AlertTriangle,
  Backpack,
  Check,
  ChevronRight,
  CircleGauge,
  Copy,
  Database,
  ExternalLink,
  FlaskConical,
  Gauge,
  LoaderCircle,
  PackageOpen,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  appErrorMessageKey,
  pricingErrorCode,
  type OptimizerWorkerErrorMessage,
  type PricingErrorCode,
} from "./app-errors";
import { appLanguage, appLocale, LANGUAGE_STORAGE_KEY, type AppLanguage } from "./i18n";
import {
  CARRY_WEIGHT_KEY,
  calculateStat,
  calculateTotals,
  EXPOSURE_KEYS,
  rarityOptions,
  RARITY_MIDPOINT_QUALITIES,
  RARITY_NAMES,
  STAT_OPTIONS,
  statCategory,
} from "./calculations";
import {
  assetUrl,
  EXBO_REPOSITORY,
  loadCatalog,
  loadItem,
  parseArtifact,
  parseContainer,
  translated,
  type Catalog,
} from "./data";
import {
  BRUTE_FORCE_COMBINATION_LIMIT,
  candidateCombinationCount,
  groupedCombinationCount,
  harmfulEffectConstraint,
  OPTIMIZER_HARMFUL_OPTIONS,
  OPTIMIZER_STAT_OPTIONS,
  normalizedObjectiveValue,
  optimizerEngineFor,
  requiredPositiveEffectConstraint,
  type OptimizerConstraint,
  type OptimizerEngine,
  type OptimizerObjective,
  type OptimizerProgress,
  type OptimizerSearchResult,
  type NegativeEffectPolicy,
} from "./optimizer";
import type { MilpProgress } from "./milp-optimizer";
import {
  IMPORTANT_OBJECTIVE_WEIGHT,
  NEUTRAL_OBJECTIVE_WEIGHT,
  OBJECTIVE_PRIORITIES,
  objectiveWeightPercentage,
} from "./objective-priorities";
import {
  artifactPrice,
  DEFAULT_PRICING_REGION,
  formatPrice,
  isPricingRegion,
  loadPricingIndex,
  priceSource,
  priceSourceDetails,
  priceSourceLabel,
  pricingMetadata,
  pricingRegionAvailable,
  PRICING_REGIONS,
  type PriceEstimate,
  type PricingRegion,
} from "./pricing";
import type {
  ArtifactConfig,
  ArtifactData,
  BonusProperty,
  ContainerData,
  ListingEntry,
  PersistedBuild,
  TotalStat,
} from "./types";

const STORAGE_KEY = "field-kit-build-v1";
const OPTIMIZER_STORAGE_KEY = "field-kit-optimizer-v1";
const PRICING_REGION_STORAGE_KEY = "field-kit-pricing-region-v1";
const MILP_SLOW_NOTICE_MS = 15_000;
const MILP_STALLED_TIMEOUT_MS = 60_000;
const CATEGORY_ORDER = [
  "Mobility & utility",
  "Survivability",
  "Protection",
  "Exposure",
  "Other effects",
];
const OPTIMIZER_FILTER_CATEGORIES = [
  "Mobility",
  "Survivability",
  "Healing",
  "Protection",
  "Countering",
] as const;
type OptimizerFilterCategory = typeof OPTIMIZER_FILTER_CATEGORIES[number];
const MOBILITY_FILTER_KEYS = new Set([
  "stalker.artefact_properties.factor.speed_modifier",
  "stalker.artefact_properties.factor.sprint_speed_modifier",
  "stalker.artefact_properties.factor.stamina_regeneration_bonus",
  "stalker.artefact_properties.factor.max_weight_bonus",
  "stalker.artefact_properties.factor.stamina_bonus",
]);
const HEALING_FILTER_KEYS = new Set([
  "stalker.artefact_properties.factor.artefakt_heal",
  "stalker.artefact_properties.factor.heal_efficiency",
  "stalker.artefact_properties.factor.regeneration_bonus",
]);
const SURVIVABILITY_FILTER_KEYS = new Set([
  "stalker.artefact_properties.factor.bullet_dmg_factor",
  "stalker.artefact_properties.factor.health_bonus",
  "stalker.artefact_properties.factor.bleeding_protection",
  "stalker.artefact_properties.factor.stopping_protection",
]);

function optimizerFilterCategory(key: string): OptimizerFilterCategory {
  if (OPTIMIZER_STAT_OPTIONS.find(([optionKey]) => optionKey === key)?.[3] === -1) return "Countering";
  if (MOBILITY_FILTER_KEYS.has(key)) return "Mobility";
  if (HEALING_FILTER_KEYS.has(key)) return "Healing";
  if (SURVIVABILITY_FILTER_KEYS.has(key)) return "Survivability";
  return "Protection";
}
const DEFAULT_OBJECTIVE_WEIGHTS = new Map<string, number>([
  ["stalker.artefact_properties.factor.speed_modifier", IMPORTANT_OBJECTIVE_WEIGHT],
  ["stalker.artefact_properties.factor.sprint_speed_modifier", NEUTRAL_OBJECTIVE_WEIGHT],
  ["stalker.artefact_properties.factor.stamina_regeneration_bonus", NEUTRAL_OBJECTIVE_WEIGHT],
  ["stalker.artefact_properties.factor.bullet_dmg_factor", NEUTRAL_OBJECTIVE_WEIGHT],
]);

type PositiveFilter = {
  key: string;
  enabled: boolean;
  weight: number;
  minimum: string;
};

type NegativeFilter = {
  key: string;
  policy: NegativeEffectPolicy;
  limit: string;
};

type PersistedOptimizerSettings = {
  version: 1;
  level: number;
  selectedRarities: number[];
  positiveFilters: PositiveFilter[];
  negativeFilters: NegativeFilter[];
  maxTotalPrice: string;
};

const DEFAULT_POSITIVE_FILTERS: PositiveFilter[] = OPTIMIZER_STAT_OPTIONS.map(([key]) => ({
  key,
  enabled: DEFAULT_OBJECTIVE_WEIGHTS.has(key),
  weight: DEFAULT_OBJECTIVE_WEIGHTS.get(key) ?? NEUTRAL_OBJECTIVE_WEIGHT,
  minimum: "",
}));

const DEFAULT_NEGATIVE_FILTERS: NegativeFilter[] = OPTIMIZER_HARMFUL_OPTIONS.map((option) => ({
  key: option.key,
  policy: option.safeLimit === null ? "strict" : "safe",
  limit: "",
}));

function defaultOptimizerSettings(): PersistedOptimizerSettings {
  return {
    version: 1,
    level: 0,
    selectedRarities: [0],
    positiveFilters: DEFAULT_POSITIVE_FILTERS.map((filter) => ({ ...filter })),
    negativeFilters: DEFAULT_NEGATIVE_FILTERS.map((filter) => ({ ...filter })),
    maxTotalPrice: "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function loadSavedOptimizerSettings(): PersistedOptimizerSettings {
  const defaults = defaultOptimizerSettings();
  try {
    const value = localStorage.getItem(OPTIMIZER_STORAGE_KEY);
    if (!value) return defaults;
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 1) return defaults;

    const rawPositiveFilters = Array.isArray(parsed.positiveFilters) ? parsed.positiveFilters : [];
    const positiveFilters = defaults.positiveFilters.map((fallback) => {
      const saved = rawPositiveFilters.find((filter) => isRecord(filter) && filter.key === fallback.key);
      return !isRecord(saved) ? fallback : {
        key: fallback.key,
        enabled: typeof saved.enabled === "boolean" ? saved.enabled : fallback.enabled,
        weight: typeof saved.weight === "number" && OBJECTIVE_PRIORITIES.some((priority) => priority.weight === saved.weight)
          ? saved.weight
          : fallback.weight,
        minimum: typeof saved.minimum === "string" ? saved.minimum : fallback.minimum,
      };
    });

    const rawNegativeFilters = Array.isArray(parsed.negativeFilters) ? parsed.negativeFilters : [];
    const validPolicies: NegativeEffectPolicy[] = ["allow", "safe", "strict", "custom"];
    const negativeFilters = defaults.negativeFilters.map((fallback) => {
      const saved = rawNegativeFilters.find((filter) => isRecord(filter) && filter.key === fallback.key);
      return !isRecord(saved) ? fallback : {
        key: fallback.key,
        policy: typeof saved.policy === "string" && validPolicies.includes(saved.policy as NegativeEffectPolicy)
          ? saved.policy as NegativeEffectPolicy
          : fallback.policy,
        limit: typeof saved.limit === "string" ? saved.limit : fallback.limit,
      };
    });

    const selectedRarities = Array.isArray(parsed.selectedRarities)
      ? [...new Set(parsed.selectedRarities.filter((rarity): rarity is number =>
        Number.isInteger(rarity) && rarity >= 0 && rarity < RARITY_NAMES.length))].sort((left, right) => left - right)
      : defaults.selectedRarities;

    return {
      version: 1,
      level: typeof parsed.level === "number" && Number.isFinite(parsed.level)
        ? clamp(Math.round(parsed.level), 0, 15)
        : defaults.level,
      selectedRarities,
      positiveFilters,
      negativeFilters,
      maxTotalPrice: typeof parsed.maxTotalPrice === "string" ? parsed.maxTotalPrice : defaults.maxTotalPrice,
    };
  } catch {
    return defaults;
  }
}

function loadSavedPricingRegion(): PricingRegion {
  try {
    const value = localStorage.getItem(PRICING_REGION_STORAGE_KEY);
    return value && isPricingRegion(value) ? value : DEFAULT_PRICING_REGION;
  } catch {
    return DEFAULT_PRICING_REGION;
  }
}

type PickerState =
  | { kind: "container" }
  | { kind: "artifact"; index: number }
  | null;

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function loadSavedBuild(): PersistedBuild | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as PersistedBuild;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value: number, percentage: boolean) {
  const clean = Math.abs(value) < 0.005 ? 0 : value;
  return `${new Intl.NumberFormat(appLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(clean)}${percentage ? "%" : ""}`;
}

function formatAccuracy(value: number) {
  const digits = value >= 10 ? 1 : value >= 1 ? 2 : value >= 0.01 ? 3 : 4;
  return new Intl.NumberFormat(appLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function formatSolveSeconds(value: number) {
  const digits = value < 1 ? 2 : 1;
  return `${new Intl.NumberFormat(appLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}s`;
}

function formatTimeLimitSeconds(value: number) {
  const suffix = appLanguage() === "ru" ? " с" : "s";
  return `${new Intl.NumberFormat(appLocale(), { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

function formatInteger(value: number | bigint) {
  return new Intl.NumberFormat(appLocale(), { maximumFractionDigits: 0 }).format(value);
}

function formatDecimal(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat(appLocale(), { maximumFractionDigits }).format(value);
}

function ItemImage({ entry, size = "normal" }: { entry: ListingEntry; size?: "normal" | "large" }) {
  return (
    <span className={`item-image item-image--${size}`} data-rank={entry.color}>
      <img src={assetUrl(entry.icon)} alt="" loading="lazy" />
    </span>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PriceDisplay({ estimate, region, className = "" }: { estimate: PriceEstimate | null; region: PricingRegion; className?: string }) {
  const { t } = useTranslation();
  const source = priceSource(estimate);
  const formattedPrice = estimate ? formatPrice(estimate.median) : t("Price unavailable");
  return (
    <span
      aria-label={estimate ? t("{{source}} price: {{price}}", { source: priceSourceLabel(estimate), price: formattedPrice }) : formattedPrice}
      className={`price-display price-display--${source} ${className}`.trim()}
      title={priceSourceDetails(estimate, region)}
    >
      <strong>{formattedPrice}</strong>
    </span>
  );
}

function Picker({
  state,
  catalog,
  onClose,
  onChoose,
  selecting,
  pricingRegion,
}: {
  state: Exclude<PickerState, null>;
  catalog: Catalog;
  onClose: () => void;
  onChoose: (entry: ListingEntry) => void;
  selecting: string | null;
  pricingRegion: PricingRegion;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const inputRef = useRef<HTMLInputElement>(null);
  const entries = state.kind === "container" ? catalog.containers : catalog.artifacts;
  const filtered = entries.filter((entry) =>
    translated(entry.name).toLowerCase().includes(deferredQuery),
  );

  useEffect(() => {
    inputRef.current?.focus();
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={state.kind === "container" ? t("Choose a backpack or container") : t("Choose an artifact")}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="picker-header">
          <div>
            <p className="eyebrow">{t("EXBO DATABASE")}</p>
            <h2>{state.kind === "container" ? t("Choose a backpack or container") : t("Choose an artifact")}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={t("Close")}>
            <X size={20} />
          </button>
        </div>
        <label className="search-box">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={state.kind === "container" ? t("Search backpacks and containers…") : t("Search artifacts…")}
          />
          <kbd>{filtered.length}</kbd>
        </label>
        <div className="picker-list">
          {filtered.map((entry) => {
            const isLoading = selecting === entry.data;
            const price = state.kind === "artifact" ? artifactPrice(entry, 0, pricingRegion) : null;
            return (
              <button
                className="picker-row"
                key={entry.data}
                onClick={() => onChoose(entry)}
                disabled={Boolean(selecting)}
              >
                <ItemImage entry={entry} />
                <span className="picker-row__name">{translated(entry.name)}</span>
                <span className="picker-row__type">
                  {entry.data.includes("/backpacks/")
                    ? t("Backpack")
                    : entry.data.includes("/containers/")
                      ? t("Container")
                      : t(entry.data.split("/").at(-2)?.replaceAll("_", " ") ?? "")}
                </span>
                {state.kind === "artifact" && (
                  <PriceDisplay estimate={price} region={pricingRegion} className="picker-row__price" />
                )}
                {isLoading ? <LoaderCircle className="spin" size={18} /> : <ChevronRight size={18} />}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="empty-search">
              <PackageOpen size={30} />
              <p>{t("No items match “{{query}}”.", { query })}</p>
            </div>
          )}
        </div>
        <p className="picker-footer">{t("Items load live from EXBO Studio. Prices load directly from the {{region}} market-history index ({{date}}).", { region: pricingMetadata(pricingRegion).region, date: pricingMetadata(pricingRegion).asOfLabel })}</p>
      </section>
    </div>
  );
}

function CarrierSelector({
  container,
  onChooseContainer,
}: {
  container: ContainerData | null;
  onChooseContainer: () => void;
}) {
  const { t } = useTranslation();
  const carrierCarryWeight = container?.stats.find((stat) => stat.key === CARRY_WEIGHT_KEY)?.max;

  return (
    <>
      {container ? (
        <button className="container-card" onClick={onChooseContainer}>
          <ItemImage entry={container.entry} size="large" />
          <span className="container-card__main">
            <small>{container.entry.data.includes("/backpacks/") ? t("Backpack").toUpperCase() : t("Container").toUpperCase()}</small>
            <strong>{translated(container.item.name)}</strong>
            <span>{t("Click to replace")}</span>
          </span>
          <ChevronRight size={20} />
        </button>
      ) : (
        <button className="container-empty" onClick={onChooseContainer}>
          <span className="container-empty__icon"><Plus size={24} /></span>
          <strong>{t("Select a backpack or container")}</strong>
          <span>{t("Your available artifact slots will appear here.")}</span>
        </button>
      )}

      {container && (
        <div className="container-specs">
          <StatPill label={t("SLOTS")} value={String(container.capacity)} />
          <StatPill label={t("PROTECTION")} value={`${formatAccuracy(container.protection)}%`} />
          <StatPill label={t("EFFECT")} value={`${formatAccuracy(container.effectiveness)}%`} />
          {carrierCarryWeight !== undefined && <StatPill label={t("CARRY WEIGHT")} value={`${formatNumber(carrierCarryWeight, false)} kg`} />}
        </div>
      )}
    </>
  );
}

function ContainerPanel({
  container,
  artifacts,
  activeIndex,
  onChooseContainer,
  onChooseArtifact,
  onActivate,
  onRemove,
  onCopy,
  pricingRegion,
}: {
  container: ContainerData | null;
  artifacts: Array<ArtifactConfig | null>;
  activeIndex: number | null;
  onChooseContainer: () => void;
  onChooseArtifact: (index: number) => void;
  onActivate: (index: number) => void;
  onRemove: (index: number) => void;
  onCopy: (index: number) => void;
  pricingRegion: PricingRegion;
}) {
  const { t } = useTranslation();

  return (
    <section className="panel loadout-panel" id="loadout">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{t("01 / LOADOUT")}</p>
          <h2>{t("Backpack / container & artifacts")}</h2>
        </div>
        <Backpack size={22} />
      </div>

      <CarrierSelector container={container} onChooseContainer={onChooseContainer} />

      {container && (
        <>
          <div className="slot-heading">
            <span>{t("Artifact slots")}</span>
            <span>{artifacts.filter(Boolean).length} / {container.capacity}</span>
          </div>
          <div className="artifact-slots">
            {artifacts.map((artifact, index) => (
              <div
                className={`artifact-slot ${activeIndex === index ? "artifact-slot--active" : ""}`}
                key={index}
              >
                <button
                  className="artifact-slot__body"
                  onClick={() => artifact ? onActivate(index) : onChooseArtifact(index)}
                >
                  <span className="slot-number">{String(index + 1).padStart(2, "0")}</span>
                  {artifact ? (
                    <>
                      <ItemImage entry={artifact.entry} />
                      <span className="artifact-slot__name">
                        <strong>{translated(artifact.item.name)}</strong>
                        <small>+{artifact.level} · {formatDecimal(artifact.quality)}% · {t(RARITY_NAMES[artifact.rarityIndex])}</small>
                      </span>
                      <PriceDisplay estimate={artifactPrice(artifact.entry, artifact.rarityIndex, pricingRegion)} region={pricingRegion} className="artifact-slot__price" />
                    </>
                  ) : (
                    <span className="artifact-slot__empty"><Plus size={16} /> {t("Add artifact")}</span>
                  )}
                </button>
                {artifact && (
                  <span className="slot-actions">
                    <button onClick={() => onCopy(index)} aria-label={t("Copy {{name}}", { name: translated(artifact.item.name) })} title={t("Copy to next empty slot")}>
                      <Copy size={15} />
                    </button>
                    <button onClick={() => onRemove(index)} aria-label={t("Remove {{name}}", { name: translated(artifact.item.name) })}>
                      <Trash2 size={15} />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ArtifactEditor({
  artifact,
  index,
  onChange,
  onReplace,
  pricingRegion,
}: {
  artifact: ArtifactConfig | null;
  index: number | null;
  onChange: (artifact: ArtifactConfig) => void;
  onReplace: () => void;
  pricingRegion: PricingRegion;
}) {
  const { t } = useTranslation();
  if (!artifact || index === null) {
    return (
      <section className="panel editor-panel" id="artifact">
        <div className="panel-heading">
          <div><p className="eyebrow">{t("02 / TUNE")}</p><h2>{t("Artifact settings")}</h2></div>
          <FlaskConical size={22} />
        </div>
        <div className="editor-empty">
          <span><FlaskConical size={34} /></span>
          <h3>{t("Select an artifact slot")}</h3>
          <p>{t("Choose an artifact to set its upgrade, quality, rarity, and bonus properties.")}</p>
        </div>
      </section>
    );
  }

  const options = rarityOptions(artifact.quality);
  const unlocked = [5, 10, 15].filter((level) => artifact.level >= level).length;
  const update = (patch: Partial<ArtifactConfig>) => onChange({ ...artifact, ...patch });

  const updateLevel = (level: number) => {
    const nextLevel = clamp(Math.round(level), 0, 15);
    const allowedBonuses = [5, 10, 15].filter((unlock) => nextLevel >= unlock).length;
    update({ level: nextLevel, bonuses: artifact.bonuses.slice(0, allowedBonuses) });
  };

  const updateQuality = (quality: number) => {
    const nextQuality = clamp(Number(quality.toFixed(2)), 0, 190);
    const nextOptions = rarityOptions(nextQuality);
    update({
      quality: nextQuality,
      rarityIndex: nextOptions.includes(artifact.rarityIndex)
        ? artifact.rarityIndex
        : nextOptions.at(-1)!,
    });
  };

  const addBonus = () => {
    if (artifact.bonuses.length >= unlocked) return;
    const option = STAT_OPTIONS[0];
    const bonus: BonusProperty = {
      id: makeId(),
      key: option[0],
      name: option[1],
      value: 0,
      percentage: option[2],
    };
    update({ bonuses: [...artifact.bonuses, bonus] });
  };

  const updateBonus = (id: string, patch: Partial<BonusProperty>) => {
    update({ bonuses: artifact.bonuses.map((bonus) => bonus.id === id ? { ...bonus, ...patch } : bonus) });
  };

  return (
    <section className="panel editor-panel" id="artifact">
      <div className="panel-heading">
        <div><p className="eyebrow">{t("02 / TUNE · SLOT {{slot}}", { slot: index + 1 })}</p><h2>{t("Artifact settings")}</h2></div>
        <FlaskConical size={22} />
      </div>
      <div className="selected-artifact">
        <ItemImage entry={artifact.entry} size="large" />
        <div>
          <h3>{translated(artifact.item.name)}</h3>
          <p>{t(artifact.entry.data.split("/").at(-2)?.replaceAll("_", " ") ?? "")} <PriceDisplay estimate={artifactPrice(artifact.entry, artifact.rarityIndex, pricingRegion)} region={pricingRegion} /></p>
        </div>
        <button className="text-button" onClick={onReplace}>{t("Replace")}</button>
      </div>

      <div className="control-group">
        <div className="control-label"><label htmlFor="level">{t("Upgrade level")}</label><strong>+{artifact.level}</strong></div>
        <input id="level" type="range" min="0" max="15" step="1" value={artifact.level} onChange={(event) => updateLevel(Number(event.target.value))} />
        <div className="quick-values">
          {[0, 5, 10, 15].map((value) => <button key={value} className={artifact.level === value ? "active" : ""} onClick={() => updateLevel(value)}>+{value}</button>)}
        </div>
      </div>

      <div className="control-group">
        <div className="control-label"><label htmlFor="quality">{t("Quality")}</label><strong>{formatDecimal(artifact.quality)}%</strong></div>
        <div className="number-control">
          <input id="quality" type="range" min="0" max="190" step="0.1" value={artifact.quality} onChange={(event) => updateQuality(Number(event.target.value))} />
          <input aria-label={t("Exact quality")} type="number" min="0" max="190" step="0.1" value={artifact.quality} onChange={(event) => updateQuality(Number(event.target.value))} />
        </div>
        <div className="quality-scale" aria-hidden="true"><span>0</span><span>100</span><span>115</span><span>145</span><span>190</span></div>
      </div>

      <div className="control-group">
        <div className="control-label"><span>{t("Rarity")}</span><strong>{t(RARITY_NAMES[artifact.rarityIndex])}</strong></div>
        <div className="rarity-options">
          {options.map((option) => (
            <button key={option} data-rarity={option} className={artifact.rarityIndex === option ? "active" : ""} onClick={() => update({ rarityIndex: option })}>
              {artifact.rarityIndex === option && <Check size={14} />}{t(RARITY_NAMES[option])}
            </button>
          ))}
        </div>
        {options.length > 1 && <p className="field-note">{t("This exact quality sits on a rarity boundary. Choose the color shown in game.")}</p>}
      </div>

      <div className="base-properties">
        <div className="section-label"><span>{t("Calculated base properties")}</span><span>{artifact.stats.length}</span></div>
        <ul>
          {artifact.stats.map((stat) => (
            <li key={stat.key} className={stat.positive ? "positive" : "negative"}>
              <span>{t(stat.name)}</span>
              <span>{formatNumber(
                calculateStat(
                  stat,
                  artifact.quality,
                  artifact.level,
                  artifact.rarityIndex,
                  100,
                ),
                stat.percentage,
              )}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bonus-section">
        <div className="section-label"><span>{t("Additional properties")}</span><span>{artifact.bonuses.length} / {unlocked}</span></div>
        <p className="field-note">{t("EXBO does not publish the random bonus pool. Enter the exact bonus shown on your artifact.")}</p>
        {artifact.bonuses.map((bonus) => (
          <div className="bonus-row" key={bonus.id}>
            <select
              aria-label={t("Bonus property")}
              value={bonus.key}
              onChange={(event) => {
                const option = STAT_OPTIONS.find(([key]) => key === event.target.value)!;
                updateBonus(bonus.id, { key: option[0], name: option[1], percentage: option[2] });
              }}
            >
              {STAT_OPTIONS.map(([key, name]) => <option value={key} key={key}>{t(name)}</option>)}
            </select>
            <input aria-label={t("{{name}} exact value", { name: t(bonus.name) })} type="number" step="0.01" value={bonus.value} onChange={(event) => updateBonus(bonus.id, { value: Number(event.target.value) })} />
            <span>{bonus.percentage ? "%" : ""}</span>
            <button className="icon-button" onClick={() => update({ bonuses: artifact.bonuses.filter((item) => item.id !== bonus.id) })} aria-label={t("Remove bonus")}><X size={16} /></button>
          </div>
        ))}
        {artifact.bonuses.length < unlocked && <button className="add-bonus" onClick={addBonus}><Plus size={16} /> {t("Add unlocked property")}</button>}
        {unlocked === 0 && <div className="locked-bonuses"><Sparkles size={16} /> {t("First property unlocks at +5")}</div>}
      </div>
    </section>
  );
}

function ResultPanel({
  container,
  totals,
  warnings,
}: {
  container: ContainerData | null;
  totals: TotalStat[];
  warnings: TotalStat[];
}) {
  const { t } = useTranslation();
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    stats: totals.filter((stat) => statCategory(stat) === category),
  })).filter((group) => group.stats.length);

  return (
    <section className="panel result-panel" id="results">
      <div className="panel-heading">
        <div><p className="eyebrow">{t("03 / READOUT")}</p><h2>{t("Build totals")}</h2></div>
        <CircleGauge size={22} />
      </div>
      {!container ? (
        <div className="editor-empty compact">
          <span><Gauge size={32} /></span>
          <h3>{t("Waiting for a carrier")}</h3>
          <p>{t("Select a backpack or container to begin your calculation.")}</p>
        </div>
      ) : (
        <>
          <div className={`build-status ${warnings.length ? "build-status--danger" : "build-status--safe"}`}>
            {warnings.length ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
            <div>
              <strong>{warnings.length ? t("Unsafe exposure") : t("Exposure balanced")}</strong>
              <span>{warnings.length ? t("harmfulThreshold", { count: warnings.length }) : t("No damage thresholds exceeded")}</span>
            </div>
          </div>
          {warnings.map((warning) => (
            <div className="warning" key={warning.key}>
              <AlertTriangle size={16} />
              <span>{t("{{name}} is high enough to cause damage ({{value}}).", { name: t(warning.name), value: formatNumber(warning.value, false) })}</span>
            </div>
          ))}
          {grouped.length ? grouped.map(({ category, stats }) => (
            <div className="result-group" key={category}>
              <div className="section-label"><span>{t(category)}</span></div>
              <ul>
                {stats.map((stat) => {
                  const dangerous = warnings.some((warning) => warning.key === stat.key);
                  const beneficial = EXPOSURE_KEYS.has(stat.key) ? stat.value <= 0 : !stat.harmful || stat.value > 0;
                  return (
                    <li key={stat.key} className={dangerous || !beneficial ? "negative" : "positive"}>
                      <span>{t(stat.name)}</span>
                      <strong>{formatNumber(stat.value, stat.percentage)}</strong>
                    </li>
                  );
                })}
              </ul>
            </div>
          )) : (
            <div className="no-results"><PackageOpen size={27} /><p>{t("Add an artifact to see combined properties.")}</p></div>
          )}
        </>
      )}
    </section>
  );
}

type OptimizerRun = {
  search: OptimizerSearchResult;
  candidates: ArtifactConfig[];
  objectives: OptimizerObjective[];
  failedItems: number;
  engine: OptimizerEngine;
};

type OptimizerWorkerMessage =
  | { type: "progress"; progress: OptimizerProgress | MilpProgress }
  | { type: "partial-result"; result: OptimizerSearchResult }
  | { type: "result"; result: OptimizerSearchResult }
  | OptimizerWorkerErrorMessage;

function OptimizerPanel({
  catalog,
  container,
  onChooseContainer,
  onApply,
  pricingRegion,
  pricingReady,
}: {
  catalog: Catalog | null;
  container: ContainerData | null;
  onChooseContainer: () => void;
  onApply: (artifacts: ArtifactConfig[]) => void;
  pricingRegion: PricingRegion;
  pricingReady: boolean;
}) {
  const { t } = useTranslation();
  const savedSettings = useMemo(loadSavedOptimizerSettings, []);
  const [level, setLevel] = useState(savedSettings.level);
  const [selectedRarities, setSelectedRarities] = useState<number[]>(savedSettings.selectedRarities);
  const [positiveFilters, setPositiveFilters] = useState<PositiveFilter[]>(savedSettings.positiveFilters);
  const [negativeFilters, setNegativeFilters] = useState<NegativeFilter[]>(savedSettings.negativeFilters);
  const [maxTotalPrice, setMaxTotalPrice] = useState(savedSettings.maxTotalPrice);
  const [activeEngine, setActiveEngine] = useState<OptimizerEngine | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "searching" | "done" | "error">("idle");
  const [loadProgress, setLoadProgress] = useState({ completed: 0, total: 0 });
  const [searchProgress, setSearchProgress] = useState<OptimizerProgress | MilpProgress | null>(null);
  const [milpNotice, setMilpNotice] = useState<"slow" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<OptimizerRun | null>(null);
  const cache = useRef(new Map<string, ArtifactData>());
  const workerRef = useRef<Worker | null>(null);
  const firstResultRef = useRef<HTMLElement | null>(null);
  const runIdRef = useRef(0);
  const scrollToResultRunIdRef = useRef<number | null>(null);
  const lastSearchProgressAtRef = useRef(0);
  const searchSignature = JSON.stringify({
    carrier: container?.entry.data ?? null,
    level,
    selectedRarities,
    positiveFilters,
    negativeFilters,
    maxTotalPrice,
    pricingRegion,
  });
  const signatureRef = useRef(searchSignature);
  const priceConstraintUnavailable = maxTotalPrice.trim() !== ""
    && (!pricingReady || !pricingRegionAvailable(pricingRegion));

  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => {
    const settings: PersistedOptimizerSettings = {
      version: 1,
      level,
      selectedRarities,
      positiveFilters,
      negativeFilters,
      maxTotalPrice,
    };
    localStorage.setItem(OPTIMIZER_STORAGE_KEY, JSON.stringify(settings));
  }, [level, selectedRarities, positiveFilters, negativeFilters, maxTotalPrice]);
  useEffect(() => {
    if (signatureRef.current === searchSignature) return;
    signatureRef.current = searchSignature;
    runIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setRun(null);
    setError(null);
    setSearchProgress(null);
    setMilpNotice(null);
    setActiveEngine(null);
    setState("idle");
    scrollToResultRunIdRef.current = null;
  }, [searchSignature]);
  useEffect(() => {
    if (!run?.search.results.length || scrollToResultRunIdRef.current !== runIdRef.current) return;
    scrollToResultRunIdRef.current = null;
    window.requestAnimationFrame(() => firstResultRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    }));
  }, [run?.search.results.length]);

  const estimatedCombinations = catalog && container
    ? groupedCombinationCount(catalog.artifacts.length, selectedRarities.length, container.capacity, true)
    : 0;
  const estimatedEngine = optimizerEngineFor(estimatedCombinations);
  const activeObjectives: OptimizerObjective[] = positiveFilters
    .filter((filter) => filter.enabled)
    .map((filter) => {
      const option = OPTIMIZER_STAT_OPTIONS.find(([key]) => key === filter.key)!;
      return { key: filter.key, weight: filter.weight, direction: option[3] };
    });
  const objectiveWeights = activeObjectives.map((objective) => objective.weight);
  const invalidPositiveMinimum = positiveFilters.some((filter) =>
    filter.minimum !== "" && (!Number.isFinite(Number(filter.minimum)) || Number(filter.minimum) <= 0));
  const invalidCustomLimit = negativeFilters.some((filter) =>
    filter.policy === "custom" && (filter.limit === "" || !Number.isFinite(Number(filter.limit)) || Number(filter.limit) < 0));
  const constraints: OptimizerConstraint[] = [
    ...positiveFilters
      .filter((filter) => filter.enabled)
      .map((filter) => requiredPositiveEffectConstraint(
        filter.key,
        filter.minimum !== "" && !invalidPositiveMinimum ? Number(filter.minimum) : null,
        OPTIMIZER_STAT_OPTIONS.find(([key]) => key === filter.key)![3],
      )),
    ...negativeFilters.flatMap((filter) => {
      const option = OPTIMIZER_HARMFUL_OPTIONS.find((item) => item.key === filter.key)!;
      const constraint = harmfulEffectConstraint(
        option,
        filter.policy,
        filter.policy === "custom" && !invalidCustomLimit ? Number(filter.limit) : null,
      );
      return constraint ? [constraint] : [];
    }),
  ];
  const parsedMaxTotalPrice = maxTotalPrice === "" ? null : Number(maxTotalPrice);
  const invalidMaxTotalPrice = parsedMaxTotalPrice !== null
    && (!Number.isFinite(parsedMaxTotalPrice) || parsedMaxTotalPrice <= 0);

  const loadCandidates = async (runId: number) => {
    if (!catalog) return { items: [] as ArtifactData[], failed: 0 };
    const output = new Array<ArtifactData | null>(catalog.artifacts.length).fill(null);
    let cursor = 0;
    let completed = 0;
    let failed = 0;
    setLoadProgress({ completed: 0, total: catalog.artifacts.length });

    const loadNext = async () => {
      while (cursor < catalog.artifacts.length) {
        const index = cursor;
        cursor += 1;
        const entry = catalog.artifacts[index];
        try {
          const cached = cache.current.get(entry.data);
          const data = cached ?? parseArtifact(entry, await loadItem(entry));
          cache.current.set(entry.data, data);
          output[index] = data;
        } catch {
          failed += 1;
        }
        completed += 1;
        if (runId === runIdRef.current) {
          setLoadProgress({ completed, total: catalog.artifacts.length });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(10, catalog.artifacts.length) }, loadNext));
    return { items: output.filter((item): item is ArtifactData => item !== null), failed };
  };

  const startSearch = async () => {
    if (!catalog || !container || activeObjectives.length === 0 || selectedRarities.length === 0
      || invalidMaxTotalPrice || invalidPositiveMinimum || invalidCustomLimit || priceConstraintUnavailable) return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    scrollToResultRunIdRef.current = runId;
    workerRef.current?.terminate();
    workerRef.current = null;
    setError(null);
    setRun(null);
    setSearchProgress(null);
    setMilpNotice(null);
    setActiveEngine(null);
    setState("loading");

    const loaded = await loadCandidates(runId);
    if (runId !== runIdRef.current) return;
    if (loaded.items.length === 0) {
      setError("No artifact data could be loaded from EXBO.");
      setState("error");
      return;
    }

    const candidateConfigs: ArtifactConfig[] = loaded.items.flatMap((artifact, artifactIndex) =>
      selectedRarities.map((candidateRarity) => ({
        ...artifact,
        uid: `optimizer-${artifactIndex}-${candidateRarity}`,
        quality: RARITY_MIDPOINT_QUALITIES[candidateRarity],
        level,
        rarityIndex: candidateRarity,
        bonuses: [],
      })));
    const candidatePrices = candidateConfigs.map((artifact) => artifactPrice(artifact.entry, artifact.rarityIndex, pricingRegion)?.median ?? null);
    const optimizerCandidates = candidateConfigs.map((candidate, index) => ({
      name: candidate.name,
      stats: candidate.stats,
      price: candidatePrices[index],
      identity: candidate.entry.data,
      quality: candidate.quality,
      rarityIndex: candidate.rarityIndex,
    }));
    const actualCombinations = candidateCombinationCount(optimizerCandidates, container.capacity, true);
    const selectedEngine = optimizerEngineFor(actualCombinations);
    setActiveEngine(selectedEngine);

    const worker = selectedEngine === "milp"
      ? new Worker(new URL("./milp-optimizer.worker.ts", import.meta.url), { type: "module" })
      : new Worker(new URL("./optimizer.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    lastSearchProgressAtRef.current = Date.now();
    setState("searching");
    worker.onmessage = (event: MessageEvent<OptimizerWorkerMessage>) => {
      if (runId !== runIdRef.current) return;
      if (event.data.type === "progress") {
        lastSearchProgressAtRef.current = Date.now();
        setSearchProgress(event.data.progress);
        setMilpNotice(null);
        return;
      }
      if (event.data.type === "partial-result") {
        lastSearchProgressAtRef.current = Date.now();
        setMilpNotice(null);
        setRun({
          search: event.data.result,
          candidates: candidateConfigs,
          objectives: activeObjectives,
          failedItems: loaded.failed,
          engine: selectedEngine,
        });
        return;
      }
      worker.terminate();
      workerRef.current = null;
      setMilpNotice(null);
      if (event.data.type === "error") {
        console.error(`Optimizer error [${event.data.code}]: ${event.data.technicalMessage}`);
        setError(appErrorMessageKey(event.data.code));
        setState("error");
        return;
      }
      setRun({
        search: event.data.result,
        candidates: candidateConfigs,
        objectives: activeObjectives,
        failedItems: loaded.failed,
        engine: selectedEngine,
      });
      setState("done");
    };
    worker.onerror = (event) => {
      worker.terminate();
      workerRef.current = null;
      setMilpNotice(null);
      console.error("Optimizer worker error:", event.message);
      setError(appErrorMessageKey("optimizer_worker_failed"));
      setState("error");
    };
    worker.postMessage({
      container: {
        capacity: container.capacity,
        protection: container.protection,
        effectiveness: container.effectiveness,
        stats: container.stats,
      },
      candidates: optimizerCandidates,
      objectives: activeObjectives,
      settings: {
        quality: 100,
        level,
        rarityIndex: 0,
        allowDuplicates: true,
        constraints,
        maxTotalPrice: parsedMaxTotalPrice,
        combinationLimit: BRUTE_FORCE_COMBINATION_LIMIT,
      },
    });
  };

  const resetOptimizerSettings = () => {
    const defaults = defaultOptimizerSettings();
    runIdRef.current += 1;
    scrollToResultRunIdRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    setLevel(defaults.level);
    setSelectedRarities(defaults.selectedRarities);
    setPositiveFilters(defaults.positiveFilters);
    setNegativeFilters(defaults.negativeFilters);
    setMaxTotalPrice(defaults.maxTotalPrice);
    setRun(null);
    setError(null);
    setSearchProgress(null);
    setMilpNotice(null);
    setActiveEngine(null);
    setState("idle");
  };

  const clearOptimizerFilters = () => {
    runIdRef.current += 1;
    scrollToResultRunIdRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    setPositiveFilters((current) => current.map((filter) => ({
      ...filter,
      enabled: false,
      weight: NEUTRAL_OBJECTIVE_WEIGHT,
      minimum: "",
    })));
    setNegativeFilters(DEFAULT_NEGATIVE_FILTERS.map((filter) => ({ ...filter })));
    setMaxTotalPrice("");
    setRun(null);
    setError(null);
    setSearchProgress(null);
    setMilpNotice(null);
    setActiveEngine(null);
    setState("idle");
  };

  const applyResult = (resultIndex: number) => {
    if (!run) return;
    const result = run.search.results[resultIndex];
    onApply(result.indices.map((index) => ({
      ...structuredClone(run.candidates[index]),
      uid: makeId(),
      bonuses: [],
    })));
    window.requestAnimationFrame(() => {
      document.querySelector("#loadout")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const progressPercent = searchProgress
    ? "phase" in searchProgress
      ? ((searchProgress.phase === "ranges" ? searchProgress.completed : searchProgress.total + searchProgress.completed)
        / (searchProgress.total * 2)) * 100
      : (searchProgress.completed / searchProgress.total) * 100
    : 0;
  const displayedEngine = activeEngine ?? estimatedEngine;
  const searchDisabled = !catalog
    || !container
    || selectedRarities.length === 0
    || activeObjectives.length === 0
    || invalidPositiveMinimum
    || invalidCustomLimit
    || invalidMaxTotalPrice
    || priceConstraintUnavailable
    || state === "loading"
    || state === "searching";
  const searchButtonLabel = state === "loading"
    ? t("Loading artifacts {{completed}}/{{total}}", loadProgress)
    : state === "searching"
      ? t(displayedEngine === "milp" ? "Searching a large number of builds {{percent}}%" : "Searching {{percent}}%", { percent: Math.round(progressPercent) })
      : t("Find best builds");
  useEffect(() => {
    if (state !== "searching" || displayedEngine !== "milp") return;
    const timer = window.setInterval(() => {
      const quietMs = Date.now() - lastSearchProgressAtRef.current;
      if (quietMs >= MILP_STALLED_TIMEOUT_MS) {
        runIdRef.current += 1;
        workerRef.current?.terminate();
        workerRef.current = null;
        setMilpNotice(null);
        setSearchProgress(null);
        setError("Search took too long. Try lowering the max price, selecting fewer rarities, or disabling less important required stats.");
        setState("error");
        return;
      }
      if (quietMs >= MILP_SLOW_NOTICE_MS) {
        setMilpNotice("slow");
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [displayedEngine, state]);

  return (
    <section className="optimizer-panel" id="optimizer">
      <div className="optimizer-heading">
        <div>
          <p className="eyebrow">{t("OPTIMIZE")}</p>
          <h2>{t("Artifact build optimizer")}</h2>
          <p>{t("Choose what matters to you. Field Kit compares artifact builds and ranks the strongest matches.")}</p>
        </div>
        <div className="optimizer-heading-actions">
          <button type="button" className="optimizer-reset" aria-label={t("Restore optimizer default filters")} onClick={resetOptimizerSettings}><RotateCcw size={14} /> {t("Default filters")}</button>
          <button type="button" className="optimizer-reset" aria-label={t("Clear all optimizer filters")} onClick={clearOptimizerFilters}>{t("Clear filters")}</button>
        </div>
      </div>

      <div className="optimizer-body">
        <div className="optimizer-settings">
          <div className="optimizer-block optimizer-carrier-selector">
            <div className="section-label"><span>{t("Backpack or container")}</span><span>{container ? t("{{count}} slots", { count: container.capacity }) : t("Required")}</span></div>
            <CarrierSelector container={container} onChooseContainer={onChooseContainer} />
          </div>

          {container && (
            <>
            <div className="optimizer-block">
              <div className="section-label"><span>{t("Artifacts to search")}</span><span>{t("Applied to every artifact")}</span></div>
              <p className="field-note">{t("Each rarity uses the middle of its Not studied quality range. Random bonus properties are not included.")}</p>
              <div className="optimizer-assumptions">
                <label><span>{t("Artifact level")}</span><input aria-label={t("Optimizer level")} type="number" min="0" max="15" step="1" value={level} onChange={(event) => setLevel(clamp(Math.round(Number(event.target.value)), 0, 15))} /></label>
              </div>
              <div className="optimizer-rarity-list" role="group" aria-label={t("Rarities to search")}>
                {RARITY_NAMES.map((rarityName, candidateRarity) => (
                  <label data-rarity={candidateRarity} key={rarityName}>
                    <input
                      type="checkbox"
                      aria-label={t("Search {{rarity}} rarity", { rarity: t(rarityName) })}
                      checked={selectedRarities.includes(candidateRarity)}
                      onChange={(event) => setSelectedRarities((current) => event.target.checked
                        ? [...current, candidateRarity].sort((left, right) => left - right)
                        : current.filter((value) => value !== candidateRarity))}
                    />
                    <span>
                      <strong>{t(rarityName)}</strong>
                      <small>{t("Assumed quality: {{quality}}% · middle of Not studied range", { quality: formatDecimal(RARITY_MIDPOINT_QUALITIES[candidateRarity]) })}{candidateRarity === 6 ? ` · ${t("unpriced")}` : ""}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="optimizer-block">
              <div className="section-label"><span>{t("Stats you want")}</span><span>{t("{{count}} selected", { count: activeObjectives.length })}</span></div>
              <p className="field-note">{t("Check every stat the build must include. Importance affects ranking; Minimum requires a specific value from artifacts. Backpack and container bonuses do not count.")}</p>
              <div className="positive-filter-list">
                {OPTIMIZER_FILTER_CATEGORIES.map((category) => (
                  <section className="positive-filter-category" key={category}>
                    <h3>{t(category)}</h3>
                    {positiveFilters.filter((filter) => optimizerFilterCategory(filter.key) === category).map((filter) => {
                      const option = OPTIMIZER_STAT_OPTIONS.find(([key]) => key === filter.key)!;
                      return (
                        <div className={`positive-filter ${filter.enabled ? "positive-filter--enabled" : ""} ${filter.minimum !== "" ? "positive-filter--constrained" : ""}`} key={filter.key}>
                          <div className="positive-filter__top">
                            <label className="positive-filter__toggle">
                              <input type="checkbox" aria-label={t("Optimize {{name}}", { name: t(option[1]) })} checked={filter.enabled} onChange={(event) => setPositiveFilters((current) => current.map((item) => item.key === filter.key ? { ...item, enabled: event.target.checked, minimum: event.target.checked ? item.minimum : "" } : item))} />
                              <strong>{t(option[1])}</strong>
                            </label>
                            {filter.enabled && <span className="objective-share">{t("{{share}}% of score", { share: formatDecimal(objectiveWeightPercentage(filter.weight, objectiveWeights), 1) })}</span>}
                            {filter.enabled && <label className="positive-filter__minimum">
                              <span>{option[3] === -1 ? t("Minimum countering") : t("Minimum")}</span>
                              <input aria-label={t("Minimum {{name}} from artifacts", { name: t(option[1]) })} type="number" min="0" step="0.01" placeholder={option[3] === -1 ? t("Any amount") : t("Any > 0")} value={filter.minimum} onChange={(event) => setPositiveFilters((current) => current.map((item) => item.key === filter.key ? { ...item, minimum: event.target.value } : item))} />
                            </label>}
                          </div>
                          {filter.enabled && (
                            <div className="objective-priority" role="group" aria-label={t("{{name}} importance", { name: t(option[1]) })}>
                              {OBJECTIVE_PRIORITIES.map((priority) => <button type="button" className={filter.weight === priority.weight ? "active" : ""} aria-pressed={filter.weight === priority.weight} title={t("{{label}}: {{factor}} scoring influence", { label: t(priority.label), factor: priority.factor })} key={priority.weight} onClick={() => setPositiveFilters((current) => current.map((item) => item.key === filter.key ? { ...item, weight: priority.weight } : item))}><span>{t(priority.label)}</span><small>{priority.factor}</small></button>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
            </div>

            <div className="optimizer-block">
              <div className="section-label"><span>{t("Accepted consequences")}</span><span>{t("Final build values")}</span></div>
              <p className="field-note">{t("Game-safe keeps environmental exposure below damage thresholds and fully counters every other listed penalty.")}</p>
              <div className="negative-presets" role="group" aria-label={t("Negative effect presets")}>
                <button type="button" onClick={() => setNegativeFilters((current) => current.map((filter) => ({ ...filter, policy: "allow" })))}>{t("Allow all")}</button>
                <button type="button" onClick={() => setNegativeFilters((current) => current.map((filter) => ({ ...filter, policy: OPTIMIZER_HARMFUL_OPTIONS.find((option) => option.key === filter.key)!.safeLimit === null ? "strict" : "safe" })))}>{t("Game-safe")}</button>
                <button type="button" onClick={() => setNegativeFilters((current) => current.map((filter) => ({ ...filter, policy: "strict" })))}>{t("Fully counter all")}</button>
              </div>
              <div className="negative-filter-list">
                {negativeFilters.map((filter) => {
                  const option = OPTIMIZER_HARMFUL_OPTIONS.find((item) => item.key === filter.key)!;
                  return (
                    <div className="negative-filter" key={filter.key}>
                      <strong>{t(option.name)}</strong>
                      <select aria-label={t("{{name}} policy", { name: t(option.name) })} value={filter.policy} onChange={(event) => setNegativeFilters((current) => current.map((item) => item.key === filter.key ? { ...item, policy: event.target.value as NegativeEffectPolicy } : item))}>
                        <option value="allow">{t("Allow")}</option>
                        {option.safeLimit !== null && <option value="safe">{t("No exposure damage · max {{limit}}", { limit: option.safeLimit })}</option>}
                        <option value="strict">{t("Fully countered · 0 or better")}</option>
                        <option value="custom">{t("Set maximum penalty")}</option>
                      </select>
                      {filter.policy === "custom" && <input aria-label={t("{{name}} accepted penalty", { name: t(option.name) })} type="number" min="0" step="0.01" placeholder={t("Penalty")} value={filter.limit} onChange={(event) => setNegativeFilters((current) => current.map((item) => item.key === filter.key ? { ...item, limit: event.target.value } : item))} />}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="optimizer-block">
              <div className="section-label"><span>{t("Budget")}</span><span>{t("Optional")}</span></div>
              <label className="optimizer-budget">
                <span>{t("Maximum total price")}</span>
                <input aria-label={t("Maximum total price")} type="number" min="1" step="1000" placeholder={t("No limit")} value={maxTotalPrice} onChange={(event) => setMaxTotalPrice(event.target.value)} />
                <small>{t("Prices are based on completed {{region}} sales as of {{date}}. Estimated prices are marked. Builds with unknown prices are excluded when a budget is set.", { region: pricingMetadata(pricingRegion).region, date: pricingMetadata(pricingRegion).asOfLabel })}</small>
              </label>
              <div className="search-estimate">
                <span>{t("POSSIBLE BUILDS")}</span><strong>{formatInteger(estimatedCombinations)}</strong><small>{t("Search method: {{engine}}", { engine: displayedEngine === "milp" ? t("MILP (Mixed-Integer Linear Programming)") : t("Brute force") })}</small>
              </div>
              {selectedRarities.length === 0 && <p className="optimizer-error">{t("Select at least one artifact rarity.")}</p>}
              {activeObjectives.length === 0 && <p className="optimizer-error">{t("At least one positive effect must be enabled for optimization.")}</p>}
              {invalidPositiveMinimum && <p className="optimizer-error">{t("Positive minimums must be greater than zero.")}</p>}
              {invalidCustomLimit && <p className="optimizer-error">{t("Every accepted penalty must be zero or greater.")}</p>}
              {invalidMaxTotalPrice && <p className="optimizer-error">{t("Maximum total price must be greater than zero.")}</p>}
              {priceConstraintUnavailable && <p className="optimizer-error">{t("Live price data is required to use a maximum total price.")}</p>}
              <button className="optimizer-search" disabled={searchDisabled} onClick={startSearch}>
                {searchButtonLabel}
              </button>
              {(state === "loading" || state === "searching") && <div className="optimizer-progress"><span style={{ width: `${state === "loading" ? (loadProgress.completed / Math.max(1, loadProgress.total)) * 100 : progressPercent}%` }} /></div>}
              {state === "searching" && displayedEngine === "milp" && milpNotice === "slow" && (
                <p className="optimizer-search-note">{t("Still solving this large search. High price caps with many rarities can take much longer.")}</p>
              )}
              {error && <p className="optimizer-error" role="alert">{t(error)}</p>}
            </div>
            </>
          )}
        </div>

        <div className="optimizer-results">
          <div className="section-label"><span>{t("Ranked results")}</span><span>{run ? t("{{count}} shown", { count: run.search.results.length }) : t("Waiting")}</span></div>
          {!container ? (
            <div className="optimizer-empty"><Gauge size={28} /><span>{t("Select a backpack or container before searching.")}</span></div>
          ) : !run ? (
              <div className="optimizer-results-empty"><CircleGauge size={31} /><strong>{t("Find your best artifact build")}</strong><span>{t("Choose the stats, safety limits, rarities, and budget you care about. Field Kit will compare matching artifact combinations and rank the best builds.")}</span><button className="optimizer-search optimizer-results-empty__search" disabled={searchDisabled} onClick={startSearch}>{searchButtonLabel}</button></div>
            ) : run.search.results.length === 0 ? (
              <div className="optimizer-results-empty"><AlertTriangle size={31} /><strong>{t("No builds match your filters")}</strong><span>{t("Try lowering a minimum, allowing more negative effects, raising the budget, or selecting more rarities.")}</span></div>
            ) : (
              <>
                <div className="optimizer-summary">
                  {run.engine === "milp"
                    ? state === "searching"
                      ? <><strong>{t("MILP search")}</strong> · {t("{{count}} of 10 best builds found · looking for more", { count: run.search.results.length })}</>
                      : <><strong>{t("MILP search")}</strong> · {t("{{count}} best builds found", { count: run.search.results.length })}</>
                    : t("{{combinations}} builds checked · {{feasible}} matched your filters", { combinations: formatInteger(run.search.combinations), feasible: formatInteger(run.search.feasibleCombinations ?? 0) })}
                  {run.failedItems > 0 && <span> · {t("artifactFilesUnavailable", { count: run.failedItems })}</span>}
                </div>
                <p className="optimizer-score-note">{t("Match score compares each build with the best value found for every selected stat, using your importance settings.")}</p>
                {run.search.ranges.some((range) => range.approximate) && (
                  <p className="optimizer-accuracy-note">{t("Some best possible values are estimates because the search reached its 5-second limit. Each affected stat shows how much higher the true best could be.")}</p>
                )}
                <div className="optimizer-result-list">
                  {run.search.results.map((result, resultIndex) => {
                    const selected = result.indices.map((index) => run.candidates[index]);
                    const resultTotals = calculateTotals(container, selected);
                    const objectiveKeys = new Set(run.objectives.map((objective) => objective.key));
                    const totalsByKey = new Map(resultTotals.totals.map((stat) => [stat.key, stat]));
                    const remainingGroups = CATEGORY_ORDER.map((category) => ({
                      category,
                      stats: resultTotals.totals.filter((stat) => !objectiveKeys.has(stat.key) && statCategory(stat) === category),
                    })).filter((group) => group.stats.length);
                    const resultStatClass = (stat: TotalStat) => {
                      const dangerous = resultTotals.warnings.some((warning) => warning.key === stat.key);
                      const beneficial = EXPOSURE_KEYS.has(stat.key) ? stat.value <= 0 : !stat.harmful || stat.value > 0;
                      return dangerous || !beneficial ? "negative" : "positive";
                    };
                    return (
                      <article className="optimizer-result" ref={resultIndex === 0 ? firstResultRef : undefined} key={result.indices.join("-")}>
                        <div className="optimizer-result__top"><span>#{resultIndex + 1}</span><strong>{t("{{score}} match score", { score: formatAccuracy(result.score * 100) })}</strong><span className="optimizer-result__price">{formatPrice(result.totalPrice)}</span><small className={resultTotals.warnings.length ? "unsafe" : "safe"}>{resultTotals.warnings.length ? t("Exposure damage") : t("No exposure damage")}</small></div>
                        {result.approximate && <p className="optimizer-result__accuracy approximate">
                          {result.solveSeconds === undefined
                            ? result.errorPercent === undefined
                              ? t("Best build found so far · difference from the true best is unknown")
                              : t("Best build found so far · another build may score up to {{error}}% higher", { error: formatAccuracy(result.errorPercent) })
                            : result.errorPercent === undefined
                              ? t("Best build found within {{time}} time limit · difference from the true best is unknown", { time: formatTimeLimitSeconds(result.solveSeconds) })
                              : t("Best build found within {{time}} time limit · another build may score up to {{error}}% higher", { time: formatTimeLimitSeconds(result.solveSeconds), error: formatAccuracy(result.errorPercent) })}
                        </p>}
                        <div className="optimizer-artifacts">{selected.map((artifact, index) => {
                          const estimate = artifactPrice(artifact.entry, artifact.rarityIndex, pricingRegion);
                          const artifactName = translated(artifact.item.name);
                          return <span key={`${artifact.entry.data}-${artifact.rarityIndex}-${index}`} title={`${artifactName} · ${t(RARITY_NAMES[artifact.rarityIndex])} · ${priceSourceDetails(estimate, pricingRegion)}`}><ItemImage entry={artifact.entry} /><small><span>{artifactName}</span><span className="optimizer-artifact__rarity">{t(RARITY_NAMES[artifact.rarityIndex])}</span></small><PriceDisplay estimate={estimate} region={pricingRegion} className="optimizer-artifact__price" /></span>;
                        })}</div>
                        <div className="optimizer-effect-groups">
                          <div className="optimizer-effect-group optimizer-effect-group--searched">
                            <div className="section-label"><span>{t("Your priorities")}</span></div>
                            <ul>
                              {run.objectives.map((objective, objectiveIndex) => {
                                const option = OPTIMIZER_STAT_OPTIONS.find(([key]) => key === objective.key)!;
                                const range = run.search.ranges[objectiveIndex];
                                const normalized = normalizedObjectiveValue(result.values[objectiveIndex], range.min, range.max, objective.direction);
                                const best = objective.direction === -1 ? range.min : range.max;
                                const stat = totalsByKey.get(objective.key) ?? { key: objective.key, name: option[1], value: result.values[objectiveIndex], percentage: option[2], harmful: false };
                                const fillPercentage = Math.max(0, Math.min(100, normalized * 100));
                                return <li className={`${resultStatClass(stat)} optimizer-objective`} key={objective.key}>
                                  <div className="optimizer-objective__heading"><span>{t(option[1])}</span><strong>{formatNumber(stat.value, stat.percentage)}</strong></div>
                                  <div className="optimizer-objective__track" aria-label={t("{{name}} compared with best", { name: t(option[1]) })}><i style={{ width: `${fillPercentage}%` }} /><b style={{ left: `${fillPercentage}%` }} /></div>
                                  <div className="optimizer-objective__meta">
                                    {range.approximate && <span className="approximate">
                                      {range.errorPercent === undefined
                                        ? t("Best found · true maximum unknown")
                                        : t("Best found · true maximum may be up to {{error}}% higher", { error: formatAccuracy(range.errorPercent) })}
                                      {range.solveSeconds === undefined ? "" : ` · ${formatSolveSeconds(range.solveSeconds)}`}
                                    </span>}
                                    <span className="optimizer-objective__best"><small>{t(range.approximate ? "Best found" : "Best possible")}</small><b>{formatNumber(best, option[2])}</b></span>
                                  </div>
                                </li>;
                              })}
                            </ul>
                          </div>
                          <div className="optimizer-effect-groups__other">
                            {remainingGroups.map(({ category, stats }) => (
                              <div className="optimizer-effect-group" key={category}>
                                <div className="section-label"><span>{t(category)}</span></div>
                                <ul>{stats.map((stat) => <li className={resultStatClass(stat)} key={stat.key}><span>{t(stat.name)}</span><strong>{formatNumber(stat.value, stat.percentage)}</strong></li>)}</ul>
                              </div>
                            ))}
                          </div>
                        </div>
                        <button className="optimizer-apply" onClick={() => applyResult(resultIndex)}>{t("Load into calculator")}</button>
                      </article>
                    );
                  })}
                </div>
              </>
          )}
        </div>
      </div>
    </section>
  );
}

type WorkspaceMode = "optimizer" | "calculator";

export default function App() {
  const { t, i18n } = useTranslation();
  const language = appLanguage(i18n.resolvedLanguage ?? i18n.language);
  const saved = useMemo(loadSavedBuild, []);
  const savedPricingRegion = useMemo(loadSavedPricingRegion, []);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<{ name: string; message: string } | null>(null);
  const [container, setContainer] = useState<ContainerData | null>(saved?.container ?? null);
  const [artifacts, setArtifacts] = useState<Array<ArtifactConfig | null>>(saved?.artifacts ?? []);
  const [activeIndex, setActiveIndex] = useState<number | null>(() => {
    const firstConfigured = saved?.artifacts.findIndex(Boolean) ?? -1;
    return firstConfigured >= 0 ? firstConfigured : null;
  });
  const [picker, setPicker] = useState<PickerState>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [pricingRegion, setPricingRegion] = useState<PricingRegion>(savedPricingRegion);
  const [pricingStatus, setPricingStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pricingError, setPricingError] = useState<PricingErrorCode | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("optimizer");

  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal)
      .then(setCatalog)
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") setCatalogError((error as Error).message);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    loadPricingIndex()
      .then(() => {
        if (active) setPricingStatus("ready");
      })
      .catch((error: unknown) => {
        if (active) {
          const code = pricingErrorCode(error);
          console.error(`Market pricing error [${code}]:`, error);
          setPricingError(code);
          setPricingStatus("error");
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const build: PersistedBuild = { version: 1, container, artifacts };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
  }, [container, artifacts]);

  useEffect(() => {
    localStorage.setItem(PRICING_REGION_STORAGE_KEY, pricingRegion);
  }, [pricingRegion]);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = (nextLanguage: AppLanguage) => {
    void i18n.changeLanguage(nextLanguage);
  };

  const { totals, warnings } = useMemo(
    () => calculateTotals(container, artifacts),
    [container, artifacts],
  );

  const chooseItem = async (entry: ListingEntry) => {
    if (!picker) return;
    setSelectionError(null);
    setSelecting(entry.data);
    try {
      const item = await loadItem(entry);
      if (picker.kind === "container") {
        const next = parseContainer(entry, item);
        setContainer(next);
        setArtifacts((current) => Array.from({ length: next.capacity }, (_, index) => current[index] ?? null));
        setActiveIndex((current) => current !== null && current < next.capacity ? current : null);
      } else {
        const index = picker.index;
        const data = parseArtifact(entry, item);
        const artifact: ArtifactConfig = {
          ...data,
          uid: makeId(),
          level: 0,
          quality: 100,
          rarityIndex: 0,
          bonuses: [],
        };
        setArtifacts((current) => current.map((value, slot) => slot === index ? artifact : value));
        setActiveIndex(index);
      }
      setPicker(null);
    } catch (error) {
      setSelectionError({ name: translated(entry.name), message: (error as Error).message });
      setPicker(null);
    } finally {
      setSelecting(null);
    }
  };

  const resetBuild = () => {
    setContainer(null);
    setArtifacts([]);
    setActiveIndex(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const updateArtifact = (artifact: ArtifactConfig) => {
    if (activeIndex === null) return;
    setArtifacts((current) => current.map((value, index) => index === activeIndex ? artifact : value));
  };

  const copyArtifact = (index: number) => {
    const source = artifacts[index];
    const target = artifacts.findIndex((artifact) => artifact === null);
    if (!source || target < 0) return;
    const copy = {
      ...structuredClone(source),
      uid: makeId(),
      bonuses: source.bonuses.map((bonus) => ({ ...bonus, id: makeId() })),
    };
    setArtifacts((current) => current.map((value, slot) => slot === target ? copy : value));
    setActiveIndex(target);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark"><FlaskConical size={22} /></span>
          <span><strong>FIELD KIT</strong><small>{t(workspaceMode === "optimizer" ? "BUILD OPTIMIZER" : "ARTIFACT CALCULATOR")}</small></span>
        </div>
        <label className="language-select">
          <span>{t("LANGUAGE")}</span>
          <select aria-label={t("LANGUAGE")} value={language} onChange={(event) => changeLanguage(event.target.value as AppLanguage)}>
            <option value="en">English</option>
            <option value="ru">Русский</option>
          </select>
        </label>
        <label className="market-region">
          <span>{t("MARKET")}</span>
          <select aria-label={t("Market region")} value={pricingRegion} onChange={(event) => setPricingRegion(event.target.value as PricingRegion)}>
            {PRICING_REGIONS.map((region) => {
              const metadata = pricingMetadata(region);
              return <option value={region} key={region}>{metadata.region}{metadata.available ? "" : ` · ${t("unavailable")}`}</option>;
            })}
          </select>
        </label>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow"><span>{t("FIELD TOOL 01")}</span> / {t("BUILD WITH CONFIDENCE")}</p>
            <h1>{t("Balance the benefits.")}<br /><em>{t("Contain the consequences.")}</em></h1>
            <p className="hero-copy">{t(workspaceMode === "optimizer"
              ? "Search the artifact catalog for combinations that match your preferred stats, safety limits, rarities, and budget."
              : "Configure your exact artifact loadout and see every effect after container efficiency and inner protection.")}</p>
          </div>
          <div className="hero-readout">
            <Database size={18} />
            <span><small>{t("DATA SOURCE")}</small><strong>EXBO Studio / Global</strong></span>
            <span className="live-badge">{t("LIVE")}</span>
          </div>
        </section>

        {catalogError && (
          <div className="data-error" role="alert">
            <AlertTriangle size={19} />
            <span><strong>{t("Couldn’t reach the EXBO database.")}</strong> {t("Check your connection and refresh the page. Your saved build is still available.")}</span>
          </div>
        )}

        {pricingStatus === "error" && (
          <div className="data-error" role="alert">
            <AlertTriangle size={19} />
            <span><strong>{t("Couldn’t load live market prices.")}</strong> {t("Price displays and price-capped searches are unavailable: {{message}}", { message: t(appErrorMessageKey(pricingError ?? "pricing_download_failed")) })}</span>
          </div>
        )}

        {selectionError && (
          <div className="data-error" role="alert">
            <AlertTriangle size={19} />
            <span><strong>{t("Item selection failed.")}</strong> {t("Could not add {{name}}: {{message}}", selectionError)}</span>
            <button className="icon-button" onClick={() => setSelectionError(null)} aria-label={t("Dismiss item error")}><X size={16} /></button>
          </div>
        )}

        {!catalog && !catalogError && (
          <div className="loading-catalog"><LoaderCircle className="spin" size={22} /><span>{t("Loading the current artifact catalog from EXBO…")}</span></div>
        )}
        {pricingStatus === "loading" && (
          <div className="loading-catalog"><LoaderCircle className="spin" size={22} /><span>{t("Loading current market prices…")}</span></div>
        )}

        <nav className="workspace-switcher" aria-label={t("Build tools")}>
          <div className={`workspace-switcher__tab ${workspaceMode === "optimizer" ? "active" : ""}`}>
            <button type="button" className="workspace-switcher__mode" aria-label={t("Build optimizer")} aria-pressed={workspaceMode === "optimizer"} onClick={() => setWorkspaceMode("optimizer")}>
              <Gauge size={22} />
              <span><strong>{t("Build optimizer")}</strong><small>{t("Find the best catalog combination for your priorities.")}</small></span>
            </button>
          </div>
          <div className={`workspace-switcher__tab ${workspaceMode === "calculator" ? "active" : ""}`}>
            <button type="button" className="workspace-switcher__mode" aria-label={t("Build calculator")} aria-pressed={workspaceMode === "calculator"} onClick={() => setWorkspaceMode("calculator")}>
              <FlaskConical size={22} />
              <span><strong>{t("Build calculator")}</strong><small>{t("Configure artifacts you own and calculate exact totals.")}</small></span>
            </button>
            {workspaceMode === "calculator" && (
              <button type="button" className="workspace-switcher__reset" onClick={resetBuild} disabled={!container}>
                <RotateCcw size={15} /> <span>{t("Reset build")}</span>
              </button>
            )}
          </div>
        </nav>

        <div className="workspace-view" hidden={workspaceMode !== "calculator"}>
            <nav className="mobile-steps" aria-label={t("Calculator sections")}>
              <a href="#loadout">{t("01 Loadout")}</a><a href="#artifact">{t("02 Tune")}</a><a href="#results">{t("03 Results")}</a>
            </nav>
            <div className="calculator-grid">
              <ContainerPanel
                container={container}
                artifacts={artifacts}
                activeIndex={activeIndex}
                onChooseContainer={() => catalog && setPicker({ kind: "container" })}
                onChooseArtifact={(index) => catalog && setPicker({ kind: "artifact", index })}
                onActivate={setActiveIndex}
                onRemove={(index) => {
                  setArtifacts((current) => current.map((value, slot) => slot === index ? null : value));
                  if (activeIndex === index) setActiveIndex(null);
                }}
                onCopy={copyArtifact}
                pricingRegion={pricingRegion}
              />
              <ArtifactEditor
                artifact={activeIndex === null ? null : artifacts[activeIndex] ?? null}
                index={activeIndex}
                onChange={updateArtifact}
                onReplace={() => activeIndex !== null && setPicker({ kind: "artifact", index: activeIndex })}
                pricingRegion={pricingRegion}
              />
              <ResultPanel container={container} totals={totals} warnings={warnings} />
            </div>
        </div>
        <div className="workspace-view" hidden={workspaceMode !== "optimizer"}>
          <OptimizerPanel
            catalog={catalog}
            container={container}
            onChooseContainer={() => catalog && setPicker({ kind: "container" })}
            pricingRegion={pricingRegion}
            pricingReady={pricingStatus === "ready"}
            onApply={(nextArtifacts) => {
              setArtifacts(Array.from({ length: container?.capacity ?? nextArtifacts.length }, (_, index) => nextArtifacts[index] ?? null));
              setActiveIndex(nextArtifacts.length > 0 ? 0 : null);
              setWorkspaceMode("calculator");
            }}
          />
        </div>
      </main>

      <footer>
        <a href={EXBO_REPOSITORY} target="_blank" rel="noreferrer">{t("Data by EXBO Studio")} <ExternalLink size={13} /></a>
      </footer>

      {picker && catalog && <Picker state={picker} catalog={catalog} onClose={() => setPicker(null)} onChoose={chooseItem} selecting={selecting} pricingRegion={pricingRegion} />}
    </div>
  );
}
