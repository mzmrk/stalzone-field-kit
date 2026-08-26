import i18n, { appLocale } from "./i18n";
import type { ListingEntry } from "./types";

export const PRICING_INDEX_URL =
  "https://raw.githubusercontent.com/mzmrk/stalzone-market-history/main/data/pricing-index.json";
export const PRICING_REGIONS = ["eu", "ru", "na", "sea", "nea"] as const;
export type PricingRegion = typeof PRICING_REGIONS[number];
export const DEFAULT_PRICING_REGION: PricingRegion = "eu";

export type PriceEstimate = {
  median: number;
  samples: number;
  recent90Samples?: number;
  condition: "build-equivalent" | "adjacent-extrapolated";
  confidence: "high" | "medium" | "low" | "estimated";
  weighted: boolean;
  windowDays: number;
  anchorRarity?: number;
  anchorRarityName?: string;
  anchorPrice?: number;
  multiplier?: number;
};

type RegionalPricingIndex = {
  region: PricingRegion;
  snapshot: string;
  method: string;
  sourceWindow: { asOf: string; cutoff: string; days: number };
  artifacts: Record<string, Record<string, PriceEstimate>>;
};

type PricingBundle = {
  schemaVersion: 1;
  defaultRegion: PricingRegion;
  regions: Partial<Record<PricingRegion, RegionalPricingIndex>>;
};

let pricingBundle: PricingBundle | null = null;

export type PriceSource = "market" | "estimated" | "unknown";

export async function loadPricingIndex(signal?: AbortSignal, fetchImpl = fetch) {
  const response = await fetchImpl(PRICING_INDEX_URL, { headers: { accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`Price-index download failed with HTTP ${response.status}.`);
  const bundle: unknown = await response.json();
  pricingBundle = validatePricingBundle(bundle);
  return pricingBundle;
}

export function clearPricingIndex() {
  pricingBundle = null;
}

export function validatePricingBundle(value: unknown): PricingBundle {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.defaultRegion !== "eu" || !isRecord(value.regions)) {
    throw new Error("Unsupported pricing bundle schema.");
  }
  const regions: PricingBundle["regions"] = {};
  for (const [region, rawIndex] of Object.entries(value.regions)) {
    if (!isPricingRegion(region) || !isRecord(rawIndex) || rawIndex.region !== region) {
      throw new Error(`Invalid regional pricing index: ${region}.`);
    }
    if (!isRecord(rawIndex.sourceWindow) || !Number.isFinite(Date.parse(String(rawIndex.sourceWindow.asOf)))
      || !(Number(rawIndex.sourceWindow.days) > 0) || !isRecord(rawIndex.artifacts)) {
      throw new Error(`Incomplete regional pricing index: ${region}.`);
    }
    for (const rarities of Object.values(rawIndex.artifacts)) {
      if (!isRecord(rarities)) throw new Error(`Invalid artifact pricing table in ${region}.`);
      for (const estimate of Object.values(rarities)) {
        if (!isRecord(estimate) || !(Number(estimate.median) > 0) || !Number.isFinite(estimate.median)) {
          throw new Error(`Invalid artifact price estimate in ${region}.`);
        }
      }
    }
    regions[region] = rawIndex as RegionalPricingIndex;
  }
  return { schemaVersion: 1, defaultRegion: "eu", regions };
}

export function isPricingRegion(value: string): value is PricingRegion {
  return PRICING_REGIONS.includes(value as PricingRegion);
}

export function pricingRegionAvailable(region: PricingRegion) {
  return pricingBundle?.regions[region] !== undefined;
}

export function pricingMetadata(region: PricingRegion) {
  const index = pricingBundle?.regions[region];
  return {
    available: index !== undefined,
    region: region.toUpperCase(),
    asOf: index?.sourceWindow.asOf ?? null,
    asOfLabel: index ? formatDate(index.sourceWindow.asOf) : i18n.t("price data unavailable"),
    windowDays: index?.sourceWindow.days ?? null,
  };
}

export function artifactId(source: ListingEntry | string) {
  const value = typeof source === "string" ? source : source.data;
  return value.split("/").at(-1)?.replace(/\.json$/, "") ?? value;
}

export function artifactPrice(source: ListingEntry | string, rarityIndex: number, region: PricingRegion = DEFAULT_PRICING_REGION) {
  return pricingBundle?.regions[region]?.artifacts[artifactId(source)]?.[String(rarityIndex)] ?? null;
}

export function formatPrice(value: number | null) {
  return value === null ? i18n.t("Price unavailable") : `${Math.round(value).toLocaleString(appLocale())} ₽`;
}

export function priceSource(estimate: PriceEstimate | null): PriceSource {
  if (!estimate) return "unknown";
  return estimate.condition === "build-equivalent" ? "market" : "estimated";
}

export function priceSourceLabel(estimate: PriceEstimate | null) {
  const source = priceSource(estimate);
  return source === "market" ? i18n.t("Market") : source === "estimated" ? i18n.t("Estimated") : i18n.t("Unknown");
}

export function priceSourceDetails(estimate: PriceEstimate | null, region: PricingRegion = DEFAULT_PRICING_REGION) {
  const metadata = pricingMetadata(region);
  const suffix = metadata.available
    ? i18n.t("{{region}} data through {{date}}", { region: metadata.region, date: metadata.asOfLabel })
    : i18n.t("{{region}} live price data unavailable", { region: metadata.region });
  if (!estimate) return i18n.t("No eligible completed-sale estimate or same-artifact rarity anchor · {{suffix}}", { suffix });
  if (estimate.condition === "adjacent-extrapolated") {
    const anchor = estimate.anchorRarityName ? i18n.t(estimate.anchorRarityName) : i18n.t("another rarity");
    const multiplier = estimate.multiplier === undefined
      ? i18n.t("an adjacent-rarity")
      : `${new Intl.NumberFormat(appLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(estimate.multiplier)}×`;
    return i18n.t("Estimated from this artifact's {{anchor}} price using {{multiplier}} multiplier · no direct eligible sales · {{suffix}}", { anchor, multiplier, suffix });
  }
  const method = estimate.weighted ? i18n.t("recency-weighted median") : i18n.t("{{days}}-day median", { days: estimate.windowDays });
  return i18n.t("Market {{method}} from {{sales}} · {{suffix}}", {
    method,
    sales: i18n.t("completedSale", { count: estimate.samples }),
    suffix,
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(appLocale(), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
