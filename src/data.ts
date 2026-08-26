import type {
  ArtifactData,
  ContainerData,
  ListingEntry,
  ParsedStat,
  RawElement,
  RawItem,
} from "./types";
import i18n, { appLanguage } from "./i18n";

export const EXBO_REPOSITORY =
  "https://github.com/EXBO-Studio/stalzone-database";
export const EXBO_RAW_BASE =
  "https://raw.githubusercontent.com/EXBO-Studio/stalzone-database/main/global";

const STAT_PREFIX = "stalker.artefact_properties.factor.";
const WEIGHT_KEY = "core.tooltip.info.weight";
const CAPACITY_KEY = "stalker.tooltip.backpack.info.size";
const PROTECTION_KEY = "stalker.tooltip.backpack.stat_name.inner_protection";
const EFFECTIVENESS_KEY = "stalker.tooltip.backpack.stat_name.effectiveness";

export type Catalog = {
  artifacts: ListingEntry[];
  containers: ListingEntry[];
};

export function translated(text?: { lines?: Record<string, string>; text?: string }) {
  return text?.lines?.[appLanguage()] ?? text?.lines?.en ?? text?.text ?? i18n.t("Unknown item");
}

export function assetUrl(path: string) {
  return `${EXBO_RAW_BASE}${path}`;
}

export async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(assetUrl(path), { signal });
  if (!response.ok) {
    throw new Error(i18n.t("EXBO data request failed ({{status}})", { status: response.status }));
  }
  return response.json() as Promise<T>;
}

export async function loadCatalog(signal?: AbortSignal): Promise<Catalog> {
  const listing = await fetchJson<ListingEntry[]>("/listing.json", signal);
  const artifacts = listing
    .filter((entry) => entry.data.startsWith("/items/artefact/"))
    .sort(byEnglishName);
  const containers = listing
    .filter(
      (entry) =>
        entry.data.startsWith("/items/containers/") ||
        entry.data.startsWith("/items/backpacks/"),
    )
    .sort(byEnglishName);
  return { artifacts, containers };
}

function byEnglishName(a: ListingEntry, b: ListingEntry) {
  return translated(a.name).localeCompare(translated(b.name));
}

export async function loadItem(entry: ListingEntry): Promise<RawItem> {
  return fetchJson<RawItem>(entry.data);
}

export function numericElements(value: unknown): RawElement[] {
  const found: RawElement[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const object = node as RawElement;
    if (object.type === "numeric" || object.type === "range") found.push(object);
    Object.values(object).forEach(visit);
  };
  visit(value);
  return found;
}

function elementKey(element: RawElement) {
  return element.name?.key ?? element.key?.key ?? "";
}

function numberValue(element: RawElement) {
  return typeof element.value === "number" ? element.value : 0;
}

export function parseStats(item: RawItem): ParsedStat[] {
  return numericElements(item.infoBlocks)
    .filter((element) => elementKey(element).startsWith(STAT_PREFIX))
    .map((element) => {
      const numeric = numberValue(element);
      const min = element.type === "range" ? Number(element.min ?? 0) : numeric;
      const max = element.type === "range" ? Number(element.max ?? 0) : numeric;
      const formatted = element.formatted?.value?.en ?? "";
      return {
        key: elementKey(element),
        name: element.name?.lines?.en ?? element.name?.text ?? i18n.t("Unknown item", { lng: "en" }),
        min,
        max,
        positive: element.formatted?.valueColor?.toUpperCase() !== "C15252",
        percentage: formatted.includes("%"),
      };
    });
}

function property(item: RawItem, key: string) {
  const match = numericElements(item.infoBlocks).find(
    (element) => elementKey(element) === key,
  );
  return match ? numberValue(match) : 0;
}

export function parseContainer(entry: ListingEntry, item: RawItem): ContainerData {
  return {
    entry,
    item,
    name: translated(item.name),
    capacity: Math.max(1, Math.round(property(item, CAPACITY_KEY))),
    protection: property(item, PROTECTION_KEY),
    effectiveness: property(item, EFFECTIVENESS_KEY) || 100,
    weight: property(item, WEIGHT_KEY),
    stats: parseStats(item),
  };
}

export function parseWeight(item: RawItem) {
  return property(item, WEIGHT_KEY);
}

export function parseArtifact(entry: ListingEntry, item: RawItem): ArtifactData {
  return {
    entry,
    item,
    name: translated(item.name),
    weight: parseWeight(item),
    stats: parseStats(item),
  };
}
