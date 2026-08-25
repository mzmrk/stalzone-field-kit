import pricingIndexJson from "./generated/pricing-index.json";
import type { ListingEntry } from "./types";

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

type PricingIndex = {
  region: string;
  snapshot: string;
  method: string;
  sourceWindow: {
    asOf: string;
    cutoff: string;
    days: number;
  };
  artifacts: Record<string, Record<string, PriceEstimate>>;
};

const pricingIndex = pricingIndexJson as PricingIndex;

export const PRICING_REGION = pricingIndex.region.toUpperCase();
export const PRICING_SNAPSHOT = pricingIndex.snapshot;
export const PRICING_AS_OF = pricingIndex.sourceWindow.asOf;
export const PRICING_WINDOW_DAYS = pricingIndex.sourceWindow.days;
export const PRICING_AS_OF_LABEL = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(PRICING_AS_OF));

export type PriceSource = "market" | "estimated" | "unknown";

export function artifactId(source: ListingEntry | string) {
  const value = typeof source === "string" ? source : source.data;
  return value.split("/").at(-1)?.replace(/\.json$/, "") ?? value;
}

export function artifactPrice(source: ListingEntry | string, rarityIndex: number) {
  return pricingIndex.artifacts[artifactId(source)]?.[String(rarityIndex)] ?? null;
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

export function priceSourceDetails(estimate: PriceEstimate | null) {
  const suffix = `${PRICING_REGION} data through ${PRICING_AS_OF_LABEL}`;
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
