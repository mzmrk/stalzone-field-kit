import pricingIndexJson from "./generated/pricing-index.json";
import type { ListingEntry } from "./types";

type PriceEstimate = {
  median: number;
  samples: number;
};

type PricingIndex = {
  region: string;
  snapshot: string;
  method: string;
  artifacts: Record<string, Record<string, PriceEstimate>>;
};

const pricingIndex = pricingIndexJson as PricingIndex;

export const PRICING_REGION = pricingIndex.region.toUpperCase();
export const PRICING_SNAPSHOT = pricingIndex.snapshot;

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
