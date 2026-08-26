import pricingIndexJson from "./generated/pricing-index.json";
import type { ListingEntry } from "./types";

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
  sourceWindow: {
    asOf: string;
    cutoff: string;
    days: number;
  };
  artifacts: Record<string, Record<string, PriceEstimate>>;
};

type PricingBundle = {
  schemaVersion: 1;
  defaultRegion: PricingRegion;
  regions: Partial<Record<PricingRegion, RegionalPricingIndex>>;
};

const pricingBundle = pricingIndexJson as PricingBundle;

export type PriceSource = "market" | "estimated" | "unknown";

export function isPricingRegion(value: string): value is PricingRegion {
  return PRICING_REGIONS.includes(value as PricingRegion);
}

export function pricingRegionAvailable(region: PricingRegion) {
  return pricingBundle.regions[region] !== undefined;
}

export function pricingMetadata(region: PricingRegion) {
  const index = pricingBundle.regions[region];
  return {
    available: index !== undefined,
    region: region.toUpperCase(),
    asOf: index?.sourceWindow.asOf ?? null,
    asOfLabel: index ? formatDate(index.sourceWindow.asOf) : "snapshot unavailable",
    windowDays: index?.sourceWindow.days ?? null,
  };
}

export function artifactId(source: ListingEntry | string) {
  const value = typeof source === "string" ? source : source.data;
  return value.split("/").at(-1)?.replace(/\.json$/, "") ?? value;
}

export function artifactPrice(
  source: ListingEntry | string,
  rarityIndex: number,
  region: PricingRegion = DEFAULT_PRICING_REGION,
) {
  return pricingBundle.regions[region]?.artifacts[artifactId(source)]?.[String(rarityIndex)] ?? null;
}

export function formatPrice(value: number | null) {
  return value === null
    ? "Price unavailable"
    : `${Math.round(value).toLocaleString("en-US")} ₽`;
}

export function priceSource(estimate: PriceEstimate | null): PriceSource {
  if (!estimate) return "unknown";
  return estimate.condition === "build-equivalent" ? "market" : "estimated";
}

export function priceSourceLabel(estimate: PriceEstimate | null) {
  const source = priceSource(estimate);
  return source === "market" ? "Market" : source === "estimated" ? "Estimated" : "Unknown";
}

export function priceSourceDetails(
  estimate: PriceEstimate | null,
  region: PricingRegion = DEFAULT_PRICING_REGION,
) {
  const metadata = pricingMetadata(region);
  const suffix = metadata.available
    ? `${metadata.region} data through ${metadata.asOfLabel}`
    : `${metadata.region} price snapshot unavailable`;
  if (!estimate) {
    return `No eligible completed-sale estimate or same-artifact rarity anchor · ${suffix}`;
  }
  if (estimate.condition === "adjacent-extrapolated") {
    const anchor = estimate.anchorRarityName ?? "another rarity";
    const multiplier = estimate.multiplier === undefined ? "an adjacent-rarity" : `${estimate.multiplier.toFixed(2)}×`;
    return `Estimated from this artifact's ${anchor} price using ${multiplier} multiplier · no direct eligible sales · ${suffix}`;
  }
  const method = estimate.weighted ? "recency-weighted median" : `${estimate.windowDays}-day median`;
  const sales = `${estimate.samples} eligible completed ${estimate.samples === 1 ? "sale" : "sales"}`;
  return `Market ${method} from ${sales} · ${suffix}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
