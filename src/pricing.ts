import i18n, { appLocale } from "./i18n";
import { AppError, technicalErrorMessage } from "./app-errors";
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
let pricingLoadPromise: Promise<PricingBundle> | null = null;

export type PriceSource = "market" | "estimated" | "unknown";

export function loadPricingIndex(fetchImpl = fetch) {
  if (pricingBundle) return Promise.resolve(pricingBundle);
  if (pricingLoadPromise) return pricingLoadPromise;
  pricingLoadPromise = fetchImpl(PRICING_INDEX_URL, { headers: { accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) {
        throw new AppError("pricing_download_failed", `Price-index download failed with HTTP ${response.status}.`);
      }
      let value: unknown;
      try {
        value = await response.json();
      } catch (error) {
        throw new AppError("pricing_invalid_data", `Price-index response was not valid JSON: ${technicalErrorMessage(error)}`);
      }
      pricingBundle = validatePricingBundle(value);
      return pricingBundle;
    })
    .catch((error: unknown) => {
      if (error instanceof AppError) throw error;
      throw new AppError("pricing_download_failed", technicalErrorMessage(error));
    })
    .finally(() => {
      pricingLoadPromise = null;
    });
  return pricingLoadPromise;
}

export function clearPricingIndex() {
  pricingBundle = null;
  pricingLoadPromise = null;
}

export function validatePricingBundle(value: unknown): PricingBundle {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.defaultRegion !== "eu" || !isRecord(value.regions)) {
    throw new AppError("pricing_invalid_data", "Unsupported pricing bundle schema.");
  }
  const regions: PricingBundle["regions"] = {};
  for (const [region, rawIndex] of Object.entries(value.regions)) {
    if (!isPricingRegion(region) || !isRecord(rawIndex) || rawIndex.region !== region) {
      throw new AppError("pricing_invalid_data", `Invalid regional pricing index: ${region}.`);
    }
    if (typeof rawIndex.snapshot !== "string" || rawIndex.snapshot.trim() === ""
      || typeof rawIndex.method !== "string" || rawIndex.method.trim() === ""
      || !isRecord(rawIndex.sourceWindow) || !isSourceWindow(rawIndex.sourceWindow)
      || !isRecord(rawIndex.artifacts)) {
      throw new AppError("pricing_invalid_data", `Incomplete regional pricing index: ${region}.`);
    }
    for (const rarities of Object.values(rawIndex.artifacts)) {
      if (!isRecord(rarities)) throw new AppError("pricing_invalid_data", `Invalid artifact pricing table in ${region}.`);
      for (const estimate of Object.values(rarities)) {
        if (!isRecord(estimate) || !isPriceEstimate(estimate)) {
          throw new AppError("pricing_invalid_data", `Invalid artifact price estimate in ${region}.`);
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

function isSourceWindow(value: Record<string, unknown>) {
  const asOf = value.asOf;
  const cutoff = value.cutoff;
  const days = value.days;
  if (typeof asOf !== "string" || asOf.trim() === "" || !Number.isFinite(Date.parse(asOf))
    || typeof cutoff !== "string" || cutoff.trim() === "" || !Number.isFinite(Date.parse(cutoff))
    || typeof days !== "number" || !Number.isFinite(days) || !Number.isInteger(days) || days <= 0) {
    return false;
  }
  return Date.parse(cutoff) < Date.parse(asOf);
}

function isPriceEstimate(value: Record<string, unknown>) {
  const median = value.median;
  const samples = value.samples;
  const windowDays = value.windowDays;
  if (typeof median !== "number" || !Number.isFinite(median) || median <= 0
    || typeof samples !== "number" || !Number.isInteger(samples) || samples < 0
    || (value.condition !== "build-equivalent" && value.condition !== "adjacent-extrapolated")
    || (value.confidence !== "high" && value.confidence !== "medium"
      && value.confidence !== "low" && value.confidence !== "estimated")
    || typeof value.weighted !== "boolean"
    || typeof windowDays !== "number" || !Number.isFinite(windowDays)
    || !Number.isInteger(windowDays) || windowDays <= 0) {
    return false;
  }
  if (value.recent90Samples !== undefined
    && (typeof value.recent90Samples !== "number" || !Number.isInteger(value.recent90Samples)
      || value.recent90Samples < 0 || value.recent90Samples > samples)) {
    return false;
  }
  if (value.anchorRarity !== undefined
    && (typeof value.anchorRarity !== "number" || !Number.isInteger(value.anchorRarity)
      || value.anchorRarity < 0 || value.anchorRarity > 5)) {
    return false;
  }
  if (value.anchorRarityName !== undefined
    && (typeof value.anchorRarityName !== "string" || value.anchorRarityName.trim() === "")) {
    return false;
  }
  if (value.anchorPrice !== undefined
    && (typeof value.anchorPrice !== "number" || !Number.isFinite(value.anchorPrice) || value.anchorPrice <= 0)) {
    return false;
  }
  if (value.multiplier !== undefined
    && (typeof value.multiplier !== "number" || !Number.isFinite(value.multiplier) || value.multiplier <= 0)) {
    return false;
  }
  return true;
}
