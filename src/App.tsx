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
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Weight,
  X,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  calculateStat,
  calculateTotals,
  EXPOSURE_KEYS,
  rarityOptions,
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
  combinationCount,
  OPTIMIZER_STAT_OPTIONS,
  type OptimizerObjective,
  type OptimizerProgress,
  type OptimizerSearchResult,
} from "./optimizer";
import {
  NEUTRAL_OBJECTIVE_WEIGHT,
  OBJECTIVE_PRIORITIES,
  objectiveWeightPercentage,
} from "./objective-priorities";
import {
  artifactPrice,
  formatPrice,
  PRICING_REGION,
  PRICING_SNAPSHOT,
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
const CATEGORY_ORDER = [
  "Mobility & utility",
  "Survivability",
  "Protection",
  "Exposure",
  "Other effects",
];
const OPTIMIZER_COMBINATION_LIMIT = 10_000_000;
const DEFAULT_OPTIMIZER_OBJECTIVES: OptimizerObjective[] = [
  { key: "stalker.artefact_properties.factor.speed_modifier", weight: NEUTRAL_OBJECTIVE_WEIGHT },
  { key: "stalker.artefact_properties.factor.stamina_regeneration_bonus", weight: NEUTRAL_OBJECTIVE_WEIGHT },
];

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
  const sign = clean > 0 ? "+" : "";
  return `${sign}${clean.toFixed(2)}${percentage ? "%" : ""}`;
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

function Picker({
  state,
  catalog,
  onClose,
  onChoose,
  selecting,
}: {
  state: Exclude<PickerState, null>;
  catalog: Catalog;
  onClose: () => void;
  onChoose: (entry: ListingEntry) => void;
  selecting: string | null;
}) {
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
        aria-label={state.kind === "container" ? "Choose container" : "Choose artifact"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="picker-header">
          <div>
            <p className="eyebrow">EXBO DATABASE</p>
            <h2>{state.kind === "container" ? "Choose your carrier" : "Choose an artifact"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <label className="search-box">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={state.kind === "container" ? "Search backpacks and containers…" : "Search artifacts…"}
          />
          <kbd>{filtered.length}</kbd>
        </label>
        <div className="picker-list">
          {filtered.map((entry) => {
            const isLoading = selecting === entry.data;
            const price = state.kind === "artifact" ? artifactPrice(entry, 0) : null;
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
                    ? "Backpack"
                    : entry.data.includes("/containers/")
                      ? "Container"
                      : entry.data.split("/").at(-2)?.replaceAll("_", " ")}
                </span>
                {state.kind === "artifact" && (
                  <span className="picker-row__price" title={`Ordinary median from ${price?.samples ?? 0} completed sales`}>
                    {price ? formatPrice(price.median) : "No price"}
                  </span>
                )}
                {isLoading ? <LoaderCircle className="spin" size={18} /> : <ChevronRight size={18} />}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="empty-search">
              <PackageOpen size={30} />
              <p>No items match “{query}”.</p>
            </div>
          )}
        </div>
        <p className="picker-footer">Items load live from EXBO Studio. Artifact prices are saved {PRICING_REGION} auction medians.</p>
      </section>
    </div>
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
}: {
  container: ContainerData | null;
  artifacts: Array<ArtifactConfig | null>;
  activeIndex: number | null;
  onChooseContainer: () => void;
  onChooseArtifact: (index: number) => void;
  onActivate: (index: number) => void;
  onRemove: (index: number) => void;
  onCopy: (index: number) => void;
}) {
  return (
    <section className="panel loadout-panel" id="loadout">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">01 / LOADOUT</p>
          <h2>Carrier & artifacts</h2>
        </div>
        <Backpack size={22} />
      </div>

      {container ? (
        <button className="container-card" onClick={onChooseContainer}>
          <ItemImage entry={container.entry} size="large" />
          <span className="container-card__main">
            <small>{container.entry.data.includes("/backpacks/") ? "BACKPACK" : "CONTAINER"}</small>
            <strong>{container.name}</strong>
            <span>Click to replace</span>
          </span>
          <ChevronRight size={20} />
        </button>
      ) : (
        <button className="container-empty" onClick={onChooseContainer}>
          <span className="container-empty__icon"><Plus size={24} /></span>
          <strong>Select a backpack or container</strong>
          <span>Your available artifact slots will appear here.</span>
        </button>
      )}

      {container && (
        <>
          <div className="container-specs">
            <StatPill label="SLOTS" value={String(container.capacity)} />
            <StatPill label="PROTECTION" value={`${container.protection.toFixed(1)}%`} />
            <StatPill label="EFFECT" value={`${container.effectiveness.toFixed(1)}%`} />
          </div>
          <div className="slot-heading">
            <span>Artifact slots</span>
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
                        <strong>{artifact.name}</strong>
                        <small>+{artifact.level} · {artifact.quality}% · {RARITY_NAMES[artifact.rarityIndex]}</small>
                      </span>
                      <span className="artifact-slot__price">
                        {formatPrice(artifactPrice(artifact.entry, artifact.rarityIndex)?.median ?? null)}
                      </span>
                    </>
                  ) : (
                    <span className="artifact-slot__empty"><Plus size={16} /> Add artifact</span>
                  )}
                </button>
                {artifact && (
                  <span className="slot-actions">
                    <button onClick={() => onCopy(index)} aria-label={`Copy ${artifact.name}`} title="Copy to next empty slot">
                      <Copy size={15} />
                    </button>
                    <button onClick={() => onRemove(index)} aria-label={`Remove ${artifact.name}`}>
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
}: {
  artifact: ArtifactConfig | null;
  index: number | null;
  onChange: (artifact: ArtifactConfig) => void;
  onReplace: () => void;
}) {
  if (!artifact || index === null) {
    return (
      <section className="panel editor-panel" id="artifact">
        <div className="panel-heading">
          <div><p className="eyebrow">02 / TUNE</p><h2>Artifact settings</h2></div>
          <FlaskConical size={22} />
        </div>
        <div className="editor-empty">
          <span><FlaskConical size={34} /></span>
          <h3>Select an artifact slot</h3>
          <p>Choose an artifact to set its upgrade, quality, rarity, and bonus properties.</p>
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
        <div><p className="eyebrow">02 / TUNE · SLOT {index + 1}</p><h2>Artifact settings</h2></div>
        <FlaskConical size={22} />
      </div>
      <div className="selected-artifact">
        <ItemImage entry={artifact.entry} size="large" />
        <div>
          <h3>{artifact.name}</h3>
          <p>{artifact.entry.data.split("/").at(-2)?.replaceAll("_", " ")} · {formatPrice(artifactPrice(artifact.entry, artifact.rarityIndex)?.median ?? null)}</p>
        </div>
        <button className="text-button" onClick={onReplace}>Replace</button>
      </div>

      <div className="control-group">
        <div className="control-label"><label htmlFor="level">Upgrade level</label><strong>+{artifact.level}</strong></div>
        <input id="level" type="range" min="0" max="15" step="1" value={artifact.level} onChange={(event) => updateLevel(Number(event.target.value))} />
        <div className="quick-values">
          {[0, 5, 10, 15].map((value) => <button key={value} className={artifact.level === value ? "active" : ""} onClick={() => updateLevel(value)}>+{value}</button>)}
        </div>
      </div>

      <div className="control-group">
        <div className="control-label"><label htmlFor="quality">Quality</label><strong>{artifact.quality}%</strong></div>
        <div className="number-control">
          <input id="quality" type="range" min="0" max="190" step="0.1" value={artifact.quality} onChange={(event) => updateQuality(Number(event.target.value))} />
          <input aria-label="Exact quality" type="number" min="0" max="190" step="0.1" value={artifact.quality} onChange={(event) => updateQuality(Number(event.target.value))} />
        </div>
        <div className="quality-scale" aria-hidden="true"><span>0</span><span>100</span><span>115</span><span>145</span><span>190</span></div>
      </div>

      <div className="control-group">
        <div className="control-label"><span>Rarity</span><strong>{RARITY_NAMES[artifact.rarityIndex]}</strong></div>
        <div className="rarity-options">
          {options.map((option) => (
            <button key={option} data-rarity={option} className={artifact.rarityIndex === option ? "active" : ""} onClick={() => update({ rarityIndex: option })}>
              {artifact.rarityIndex === option && <Check size={14} />}{RARITY_NAMES[option]}
            </button>
          ))}
        </div>
        {options.length > 1 && <p className="field-note">This exact quality sits on a rarity boundary. Choose the color shown in game.</p>}
      </div>

      <div className="base-properties">
        <div className="section-label"><span>Calculated base properties</span><span>{artifact.stats.length}</span></div>
        <ul>
          {artifact.stats.map((stat) => (
            <li key={stat.key} className={stat.positive ? "positive" : "negative"}>
              <span>{stat.name}</span>
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
        <div className="section-label"><span>Additional properties</span><span>{artifact.bonuses.length} / {unlocked}</span></div>
        <p className="field-note">EXBO does not publish the random bonus pool. Enter the exact bonus shown on your artifact.</p>
        {artifact.bonuses.map((bonus) => (
          <div className="bonus-row" key={bonus.id}>
            <select
              aria-label="Bonus property"
              value={bonus.key}
              onChange={(event) => {
                const option = STAT_OPTIONS.find(([key]) => key === event.target.value)!;
                updateBonus(bonus.id, { key: option[0], name: option[1], percentage: option[2] });
              }}
            >
              {STAT_OPTIONS.map(([key, name]) => <option value={key} key={key}>{name}</option>)}
            </select>
            <input aria-label={`${bonus.name} exact value`} type="number" step="0.01" value={bonus.value} onChange={(event) => updateBonus(bonus.id, { value: Number(event.target.value) })} />
            <span>{bonus.percentage ? "%" : ""}</span>
            <button className="icon-button" onClick={() => update({ bonuses: artifact.bonuses.filter((item) => item.id !== bonus.id) })} aria-label="Remove bonus"><X size={16} /></button>
          </div>
        ))}
        {artifact.bonuses.length < unlocked && <button className="add-bonus" onClick={addBonus}><Plus size={16} /> Add unlocked property</button>}
        {unlocked === 0 && <div className="locked-bonuses"><Sparkles size={16} /> First property unlocks at +5</div>}
      </div>
    </section>
  );
}

function ResultPanel({
  container,
  totals,
  warnings,
  mass,
}: {
  container: ContainerData | null;
  totals: TotalStat[];
  warnings: TotalStat[];
  mass: number;
}) {
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    stats: totals.filter((stat) => statCategory(stat) === category),
  })).filter((group) => group.stats.length);

  return (
    <section className="panel result-panel" id="results">
      <div className="panel-heading">
        <div><p className="eyebrow">03 / READOUT</p><h2>Build totals</h2></div>
        <CircleGauge size={22} />
      </div>
      {!container ? (
        <div className="editor-empty compact">
          <span><Gauge size={32} /></span>
          <h3>Waiting for a carrier</h3>
          <p>Select a backpack or container to begin your calculation.</p>
        </div>
      ) : (
        <>
          <div className={`build-status ${warnings.length ? "build-status--danger" : "build-status--safe"}`}>
            {warnings.length ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
            <div>
              <strong>{warnings.length ? "Unsafe exposure" : "Exposure balanced"}</strong>
              <span>{warnings.length ? `${warnings.length} harmful threshold${warnings.length > 1 ? "s" : ""} exceeded` : "No damage thresholds exceeded"}</span>
            </div>
          </div>
          {warnings.map((warning) => (
            <div className="warning" key={warning.key}>
              <AlertTriangle size={16} />
              <span><strong>{warning.name}</strong> is high enough to cause damage ({formatNumber(warning.value, false)}).</span>
            </div>
          ))}
          <div className="summary-strip">
            <div><Weight size={17} /><span>{container.entry.data.includes("/backpacks/") ? "Backpack weight" : "Container weight"}</span><strong>{container.weight.toFixed(2)} kg</strong></div>
            <div><Weight size={17} /><span>Artifact weight</span><strong>{mass.toFixed(2)} kg</strong></div>
            <div><ShieldCheck size={17} /><span>Inner protection</span><strong>{container.protection.toFixed(1)}%</strong></div>
          </div>
          {grouped.length ? grouped.map(({ category, stats }) => (
            <div className="result-group" key={category}>
              <div className="section-label"><span>{category}</span><span>{stats.length}</span></div>
              <ul>
                {stats.map((stat) => {
                  const dangerous = warnings.some((warning) => warning.key === stat.key);
                  const beneficial = EXPOSURE_KEYS.has(stat.key) ? stat.value <= 0 : !stat.harmful || stat.value > 0;
                  return (
                    <li key={stat.key} className={dangerous || !beneficial ? "negative" : "positive"}>
                      <span>{stat.name}</span>
                      <strong>{formatNumber(stat.value, stat.percentage)}</strong>
                    </li>
                  );
                })}
              </ul>
            </div>
          )) : (
            <div className="no-results"><PackageOpen size={27} /><p>Add an artifact to see combined properties.</p></div>
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
};

type OptimizerWorkerMessage =
  | { type: "progress"; progress: OptimizerProgress }
  | { type: "result"; result: OptimizerSearchResult }
  | { type: "error"; error: string };

function OptimizerPanel({
  catalog,
  container,
  onApply,
}: {
  catalog: Catalog | null;
  container: ContainerData | null;
  onApply: (artifacts: ArtifactConfig[]) => void;
}) {
  const [quality, setQuality] = useState(100);
  const [level, setLevel] = useState(0);
  const [rarityIndex, setRarityIndex] = useState(0);
  const [objectives, setObjectives] = useState<OptimizerObjective[]>(DEFAULT_OPTIMIZER_OBJECTIVES);
  const [allowDuplicates, setAllowDuplicates] = useState(true);
  const [safeOnly, setSafeOnly] = useState(true);
  const [noNegativeEffects, setNoNegativeEffects] = useState(false);
  const [requireAllObjectives, setRequireAllObjectives] = useState(false);
  const [maxTotalPrice, setMaxTotalPrice] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "searching" | "done" | "error">("idle");
  const [loadProgress, setLoadProgress] = useState({ completed: 0, total: 0 });
  const [searchProgress, setSearchProgress] = useState<OptimizerProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<OptimizerRun | null>(null);
  const cache = useRef(new Map<string, ArtifactData>());
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const searchSignature = JSON.stringify({
    carrier: container?.entry.data ?? null,
    quality,
    level,
    rarityIndex,
    objectives,
    allowDuplicates,
    safeOnly,
    noNegativeEffects,
    requireAllObjectives,
    maxTotalPrice,
  });
  const signatureRef = useRef(searchSignature);

  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => {
    if (signatureRef.current === searchSignature) return;
    signatureRef.current = searchSignature;
    runIdRef.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setRun(null);
    setError(null);
    setSearchProgress(null);
    setState("idle");
  }, [searchSignature]);

  const rarityChoices = rarityOptions(quality);
  const estimatedCombinations = catalog && container
    ? combinationCount(catalog.artifacts.length, container.capacity, allowDuplicates)
    : 0;
  const oversized = estimatedCombinations > OPTIMIZER_COMBINATION_LIMIT;
  const activeObjectives = objectives.filter((objective) => objective.weight > 0);
  const parsedMaxTotalPrice = maxTotalPrice === "" ? null : Number(maxTotalPrice);
  const invalidMaxTotalPrice = parsedMaxTotalPrice !== null
    && (!Number.isFinite(parsedMaxTotalPrice) || parsedMaxTotalPrice <= 0);

  const updateQuality = (value: number) => {
    const nextQuality = clamp(Number(value.toFixed(2)), 0, 190);
    const choices = rarityOptions(nextQuality);
    setQuality(nextQuality);
    setRarityIndex((current) => choices.includes(current) ? current : choices[0]);
  };

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
    if (!catalog || !container || oversized || activeObjectives.length === 0 || invalidMaxTotalPrice) return;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    workerRef.current?.terminate();
    workerRef.current = null;
    setError(null);
    setRun(null);
    setSearchProgress(null);
    setState("loading");

    const loaded = await loadCandidates(runId);
    if (runId !== runIdRef.current) return;
    if (loaded.items.length === 0) {
      setError("No artifact data could be loaded from EXBO.");
      setState("error");
      return;
    }

    const candidateConfigs: ArtifactConfig[] = loaded.items.map((artifact, index) => ({
      ...artifact,
      uid: `optimizer-${index}`,
      quality,
      level,
      rarityIndex,
      bonuses: [],
    }));
    const candidatePrices = loaded.items.map((artifact) => artifactPrice(artifact.entry, rarityIndex)?.median ?? null);
    const actualCombinations = combinationCount(candidateConfigs.length, container.capacity, allowDuplicates);
    if (actualCombinations > OPTIMIZER_COMBINATION_LIMIT) {
      setError(`The ${actualCombinations.toLocaleString()}-combination search exceeds the current exact-search limit.`);
      setState("error");
      return;
    }

    const worker = new Worker(new URL("./optimizer.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setState("searching");
    worker.onmessage = (event: MessageEvent<OptimizerWorkerMessage>) => {
      if (runId !== runIdRef.current) return;
      if (event.data.type === "progress") {
        setSearchProgress(event.data.progress);
        return;
      }
      worker.terminate();
      workerRef.current = null;
      if (event.data.type === "error") {
        setError(event.data.error);
        setState("error");
        return;
      }
      setRun({
        search: event.data.result,
        candidates: candidateConfigs,
        objectives: activeObjectives,
        failedItems: loaded.failed,
      });
      setState("done");
    };
    worker.onerror = () => {
      worker.terminate();
      workerRef.current = null;
      setError("The optimizer worker stopped unexpectedly.");
      setState("error");
    };
    worker.postMessage({
      container: {
        capacity: container.capacity,
        protection: container.protection,
        effectiveness: container.effectiveness,
        stats: container.stats,
      },
      candidates: candidateConfigs.map((candidate, index) => ({
        name: candidate.name,
        stats: candidate.stats,
        price: candidatePrices[index],
      })),
      objectives: activeObjectives,
      settings: {
        quality,
        level,
        rarityIndex,
        allowDuplicates,
        safeOnly,
        noNegativeEffects,
        requireAllObjectives,
        maxTotalPrice: parsedMaxTotalPrice,
        combinationLimit: OPTIMIZER_COMBINATION_LIMIT,
      },
    });
  };

  const addObjective = () => {
    const option = OPTIMIZER_STAT_OPTIONS.find(([key]) => !objectives.some((objective) => objective.key === key));
    if (option) setObjectives((current) => [...current, {
      key: option[0],
      weight: NEUTRAL_OBJECTIVE_WEIGHT,
    }]);
  };

  const applyResult = (resultIndex: number) => {
    if (!run) return;
    const result = run.search.results[resultIndex];
    onApply(result.indices.map((index) => ({
      ...structuredClone(run.candidates[index]),
      uid: makeId(),
      bonuses: [],
    })));
    document.querySelector("#loadout")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const progressPercent = searchProgress
    ? ((searchProgress.phase === "ranges" ? searchProgress.completed : searchProgress.total + searchProgress.completed)
      / (searchProgress.total * 2)) * 100
    : 0;

  return (
    <section className="optimizer-panel" id="optimizer">
      <div className="optimizer-heading">
        <div>
          <p className="eyebrow">04 / OPTIMIZE</p>
          <h2>Weighted combination search</h2>
          <p>Enumerate every canonical loadout, derive feasible stat ranges, then rank the exact tradeoffs.</p>
        </div>
        <SlidersHorizontal size={24} />
      </div>

      {!container ? (
        <div className="optimizer-empty"><Gauge size={28} /><span>Select a carrier before searching combinations.</span></div>
      ) : (
        <div className="optimizer-body">
          <div className="optimizer-settings">
            <div className="optimizer-block">
              <div className="section-label"><span>Artifact assumptions</span><span>Catalog mode</span></div>
              <div className="optimizer-assumptions">
                <label><span>Quality</span><input aria-label="Optimizer quality" type="number" min="0" max="190" step="0.1" value={quality} onChange={(event) => updateQuality(Number(event.target.value))} /></label>
                <label><span>Level</span><input aria-label="Optimizer level" type="number" min="0" max="15" step="1" value={level} onChange={(event) => setLevel(clamp(Math.round(Number(event.target.value)), 0, 15))} /></label>
                <label><span>Rarity</span><select aria-label="Optimizer rarity" value={rarityIndex} onChange={(event) => setRarityIndex(Number(event.target.value))}>{rarityChoices.map((choice) => <option value={choice} key={choice}>{RARITY_NAMES[choice]}</option>)}</select></label>
              </div>
              <p className="field-note">Every catalog artifact uses these settings. Random additional properties are excluded.</p>
            </div>

            <div className="optimizer-block">
              <div className="section-label"><span>Weighted objectives</span><span>Relative priority</span></div>
              <div className="objective-list">
                {objectives.map((objective, index) => (
                  <div className="objective-row" key={`${objective.key}-${index}`}>
                    <div className="objective-row__top">
                      <select aria-label={`Objective ${index + 1}`} value={objective.key} onChange={(event) => setObjectives((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))}>
                        {OPTIMIZER_STAT_OPTIONS.map(([key, name]) => <option key={key} value={key} disabled={objectives.some((item, itemIndex) => itemIndex !== index && item.key === key)}>{name}</option>)}
                      </select>
                      <strong className="objective-share">{objectiveWeightPercentage(objective.weight, objectives.map((item) => item.weight)).toFixed(1).replace(".0", "")}%</strong>
                      <button className="icon-button" aria-label={`Remove objective ${index + 1}`} disabled={objectives.length === 1} onClick={() => setObjectives((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button>
                    </div>
                    <div className="objective-priority" role="group" aria-label={`Objective ${index + 1} importance`}>
                      {OBJECTIVE_PRIORITIES.map((priority) => <button type="button" className={objective.weight === priority.weight ? "active" : ""} aria-pressed={objective.weight === priority.weight} title={`${priority.label}: ${priority.factor} scoring influence`} key={priority.weight} onClick={() => setObjectives((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, weight: priority.weight } : item))}><span>{priority.label}</span><small>{priority.factor}</small></button>)}
                    </div>
                  </div>
                ))}
                <button className="add-bonus optimizer-add" disabled={objectives.length >= OPTIMIZER_STAT_OPTIONS.length} onClick={addObjective}><Plus size={15} /> Add objective</button>
              </div>
            </div>

            <div className="optimizer-block">
              <div className="section-label"><span>Search rules</span><span>Exact</span></div>
              <div className="optimizer-rules">
                <label><input type="checkbox" checked={safeOnly} onChange={(event) => setSafeOnly(event.target.checked)} /><span><strong>Safe exposure only</strong><small>Reject builds above damage thresholds</small></span></label>
                <label><input type="checkbox" checked={noNegativeEffects} onChange={(event) => setNoNegativeEffects(event.target.checked)} /><span><strong>No remaining negative effects</strong><small>Every harmful property must be fully countered</small></span></label>
                <label><input type="checkbox" checked={requireAllObjectives} onChange={(event) => setRequireAllObjectives(event.target.checked)} /><span><strong>Require every objective</strong><small>Artifacts must contribute to every objective</small></span></label>
                <label><input type="checkbox" checked={allowDuplicates} onChange={(event) => setAllowDuplicates(event.target.checked)} /><span><strong>Allow duplicate artifacts</strong><small>Enumerate combinations with replacement</small></span></label>
              </div>
              <label className="optimizer-budget">
                <span>Maximum total price</span>
                <input aria-label="Maximum total price" type="number" min="1" step="1000" placeholder="No limit" value={maxTotalPrice} onChange={(event) => setMaxTotalPrice(event.target.value)} />
                <small>Median completed-sale estimates, {PRICING_REGION} snapshot {PRICING_SNAPSHOT}. Unknown-price artifacts are excluded when enabled.</small>
              </label>
              <div className={`search-estimate ${oversized ? "search-estimate--danger" : ""}`}>
                <span>SEARCH SPACE</span><strong>{estimatedCombinations.toLocaleString()}</strong><small>canonical combinations</small>
              </div>
              {oversized && <p className="optimizer-error">This exceeds the current {OPTIMIZER_COMBINATION_LIMIT.toLocaleString()}-combination exact-search limit. Choose a carrier with fewer slots.</p>}
              {activeObjectives.length === 0 && <p className="optimizer-error">At least one objective needs a positive weight.</p>}
              {invalidMaxTotalPrice && <p className="optimizer-error">Maximum total price must be greater than zero.</p>}
              <button className="optimizer-search" disabled={!catalog || oversized || activeObjectives.length === 0 || invalidMaxTotalPrice || state === "loading" || state === "searching"} onClick={startSearch}>
                {state === "loading" ? `Loading artifacts ${loadProgress.completed}/${loadProgress.total}` : state === "searching" ? `Searching ${progressPercent.toFixed(0)}%` : `Search ${estimatedCombinations.toLocaleString()} combinations`}
              </button>
              {(state === "loading" || state === "searching") && <div className="optimizer-progress"><span style={{ width: `${state === "loading" ? (loadProgress.completed / Math.max(1, loadProgress.total)) * 100 : progressPercent}%` }} /></div>}
              {error && <p className="optimizer-error" role="alert">{error}</p>}
            </div>
          </div>

          <div className="optimizer-results">
            <div className="section-label"><span>Ranked results</span><span>{run ? `${run.search.results.length} shown` : "Waiting"}</span></div>
            {!run ? (
              <div className="optimizer-results-empty"><CircleGauge size={31} /><strong>Configure and run an exact search</strong><span>Weights are normalized automatically against the safe minimum and maximum found for each objective.</span></div>
            ) : run.search.results.length === 0 ? (
              <div className="optimizer-results-empty"><AlertTriangle size={31} /><strong>No feasible combinations</strong><span>Try disabling safe-only mode or changing the artifact assumptions.</span></div>
            ) : (
              <>
                <div className="optimizer-summary">
                  <strong>{run.search.combinations.toLocaleString()}</strong> combinations evaluated · <strong>{run.search.feasibleCombinations.toLocaleString()}</strong> feasible
                  {run.failedItems > 0 && <span> · {run.failedItems} artifact file{run.failedItems === 1 ? "" : "s"} unavailable</span>}
                </div>
                <div className="optimizer-result-list">
                  {run.search.results.map((result, resultIndex) => {
                    const selected = result.indices.map((index) => run.candidates[index]);
                    const resultTotals = calculateTotals(container, selected);
                    return (
                      <article className="optimizer-result" key={result.indices.join("-")}>
                        <div className="optimizer-result__top"><span>#{resultIndex + 1}</span><strong>{(result.score * 100).toFixed(1)} score</strong><span className="optimizer-result__price">{formatPrice(result.totalPrice)}</span><small className={resultTotals.warnings.length ? "unsafe" : "safe"}>{resultTotals.warnings.length ? "Unsafe" : "Safe"}</small></div>
                        <div className="optimizer-artifacts">{selected.map((artifact, index) => {
                          const estimate = artifactPrice(artifact.entry, rarityIndex);
                          return <span key={`${artifact.entry.data}-${index}`} title={`${artifact.name} · ${formatPrice(estimate?.median ?? null)}`}><ItemImage entry={artifact.entry} /><small>{artifact.name}</small><em>{formatPrice(estimate?.median ?? null)}</em></span>;
                        })}</div>
                        <div className="optimizer-metrics">
                          {run.objectives.map((objective, objectiveIndex) => {
                            const option = OPTIMIZER_STAT_OPTIONS.find(([key]) => key === objective.key)!;
                            const range = run.search.ranges[objectiveIndex];
                            const span = range.max - range.min;
                            const normalized = Math.abs(span) < 1e-10 ? 1 : (result.values[objectiveIndex] - range.min) / span;
                            return <div key={objective.key}><span>{option[1]}</span><strong>{formatNumber(result.values[objectiveIndex], option[2])}</strong><small>{(normalized * 100).toFixed(0)}% of feasible range · max {formatNumber(range.max, option[2])} · wt {objective.weight}</small></div>;
                          })}
                        </div>
                        <button className="optimizer-apply" onClick={() => applyResult(resultIndex)}>Load into calculator</button>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const saved = useMemo(loadSavedBuild, []);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [container, setContainer] = useState<ContainerData | null>(saved?.container ?? null);
  const [artifacts, setArtifacts] = useState<Array<ArtifactConfig | null>>(saved?.artifacts ?? []);
  const [activeIndex, setActiveIndex] = useState<number | null>(() => {
    const firstConfigured = saved?.artifacts.findIndex(Boolean) ?? -1;
    return firstConfigured >= 0 ? firstConfigured : null;
  });
  const [picker, setPicker] = useState<PickerState>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

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
    const build: PersistedBuild = { version: 1, container, artifacts };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
  }, [container, artifacts]);

  const { totals, warnings, mass } = useMemo(
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
      setSelectionError(
        `Could not add ${translated(entry.name)}: ${(error as Error).message}`,
      );
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
          <span><strong>FIELD KIT</strong><small>ARTIFACT CALCULATOR</small></span>
        </div>
        <div className="source-state">
          <span className={`source-dot ${catalogError ? "source-dot--error" : catalog ? "source-dot--ready" : ""}`} />
          <span>{catalogError ? "DATA OFFLINE" : catalog ? `EXBO LIVE · ${catalog.artifacts.length + catalog.containers.length} ITEMS` : "SYNCING EXBO DATA"}</span>
        </div>
        <button className="reset-button" onClick={resetBuild} disabled={!container}>
          <RotateCcw size={16} /> <span>Reset build</span>
        </button>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow"><span>FIELD TOOL 01</span> / BUILD WITH CONFIDENCE</p>
            <h1>Balance the benefits.<br /><em>Contain the consequences.</em></h1>
            <p className="hero-copy">Configure your exact artifact loadout and see every effect after container efficiency and inner protection.</p>
          </div>
          <div className="hero-readout">
            <Database size={18} />
            <span><small>DATA SOURCE</small><strong>EXBO Studio / Global</strong></span>
            <span className="live-badge">LIVE</span>
          </div>
        </section>

        {catalogError && (
          <div className="data-error" role="alert">
            <AlertTriangle size={19} />
            <span><strong>Couldn’t reach the EXBO database.</strong> Check your connection and refresh the page. Your saved build is still available.</span>
          </div>
        )}

        {selectionError && (
          <div className="data-error" role="alert">
            <AlertTriangle size={19} />
            <span><strong>Item selection failed.</strong> {selectionError}</span>
            <button className="icon-button" onClick={() => setSelectionError(null)} aria-label="Dismiss item error"><X size={16} /></button>
          </div>
        )}

        {!catalog && !catalogError && (
          <div className="loading-catalog"><LoaderCircle className="spin" size={22} /><span>Loading the current artifact catalog from EXBO…</span></div>
        )}

        <nav className="mobile-steps" aria-label="Calculator sections">
          <a href="#loadout">01 Loadout</a><a href="#artifact">02 Tune</a><a href="#results">03 Results</a><a href="#optimizer">04 Optimize</a>
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
          />
          <ArtifactEditor
            artifact={activeIndex === null ? null : artifacts[activeIndex] ?? null}
            index={activeIndex}
            onChange={updateArtifact}
            onReplace={() => activeIndex !== null && setPicker({ kind: "artifact", index: activeIndex })}
          />
          <ResultPanel container={container} totals={totals} warnings={warnings} mass={mass} />
        </div>
        <OptimizerPanel
          catalog={catalog}
          container={container}
          onApply={(nextArtifacts) => {
            setArtifacts(Array.from({ length: container?.capacity ?? nextArtifacts.length }, (_, index) => nextArtifacts[index] ?? null));
            setActiveIndex(nextArtifacts.length > 0 ? 0 : null);
          }}
        />
      </main>

      <footer>
        <span>FIELD KIT · Browser-side artifact planning</span>
        <a href={EXBO_REPOSITORY} target="_blank" rel="noreferrer">Data by EXBO Studio <ExternalLink size={13} /></a>
        <a href="https://stalzone.wiki/" target="_blank" rel="noreferrer">Auction history by STALZONE WIKI <ExternalLink size={13} /></a>
      </footer>

      {picker && catalog && <Picker state={picker} catalog={catalog} onClose={() => setPicker(null)} onChoose={chooseItem} selecting={selecting} />}
    </div>
  );
}
