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
  parseContainer,
  parseStats,
  parseWeight,
  translated,
  type Catalog,
} from "./data";
import type {
  ArtifactConfig,
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
        <p className="picker-footer">Item names, properties, and icons load live from EXBO Studio.</p>
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
          <p>{artifact.entry.data.split("/").at(-2)?.replaceAll("_", " ")}</p>
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
                // The result panel applies container-specific math; this preview is intentionally raw.
                stat.positive
                  ? (stat.min <= 0 && stat.max <= 0 ? Math.min(stat.min, stat.max) : Math.max(stat.min, stat.max)) * (artifact.quality / 100) * (1 + artifact.level * 0.02)
                  : stat.max,
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
            <div><Weight size={17} /><span>Artifact mass</span><strong>{mass.toFixed(2)} kg</strong></div>
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
        const artifact: ArtifactConfig = {
          uid: makeId(),
          entry,
          item,
          name: translated(item.name),
          level: 0,
          quality: 100,
          rarityIndex: 0,
          weight: parseWeight(item),
          stats: parseStats(item),
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
          <a href="#loadout">01 Loadout</a><a href="#artifact">02 Tune</a><a href="#results">03 Results</a>
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
      </main>

      <footer>
        <span>FIELD KIT · Browser-side artifact planning</span>
        <a href={EXBO_REPOSITORY} target="_blank" rel="noreferrer">Data by EXBO Studio <ExternalLink size={13} /></a>
      </footer>

      {picker && catalog && <Picker state={picker} catalog={catalog} onClose={() => setPicker(null)} onChoose={chooseItem} selecting={selecting} />}
    </div>
  );
}
