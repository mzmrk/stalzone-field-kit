import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pricingErrorCode } from "./app-errors";
import i18n from "./i18n";
import {
  artifactId,
  artifactPrice,
  clearPricingIndex,
  DEFAULT_PRICING_REGION,
  formatPrice,
  loadPricingIndex,
  pricingMetadata,
  pricingRegionAvailable,
  PRICING_REGIONS,
  priceSource,
  priceSourceDetails,
  priceSourceLabel,
  validatePricingBundle,
  type PriceEstimate,
} from "./pricing";

describe("auction pricing", () => {
  beforeEach(async () => {
    await loadPricingIndex(async () => new Response(JSON.stringify(testPricingBundle())));
  });
  afterEach(async () => {
    clearPricingIndex();
    await i18n.changeLanguage("en");
  });
  it("extracts opaque EXBO artifact IDs from listing paths", () => {
    expect(artifactId("/items/artefact/thermal/zyw2.json")).toBe("zyw2");
    expect(artifactId("zyw2")).toBe("zyw2");
  });

  it("returns the downloaded median and sample count for a rarity tier", () => {
    const ordinary = artifactPrice("zyw2", 0);
    expect(ordinary?.median).toBeGreaterThan(0);
    expect(ordinary?.samples).toBeGreaterThan(0);
  });

  it("exposes every market region while preserving EU as the default", () => {
    expect(PRICING_REGIONS).toEqual(["eu", "ru", "na", "sea", "nea"]);
    expect(DEFAULT_PRICING_REGION).toBe("eu");
    expect(pricingRegionAvailable("eu")).toBe(true);
    expect(pricingMetadata("eu")).toMatchObject({ available: true, region: "EU", windowDays: 365 });
    expect(artifactPrice("zyw2", 0, "eu")).toEqual(artifactPrice("zyw2", 0));
  });

  it("does not substitute another rarity when market data is unavailable", () => {
    expect(artifactPrice("missing-artifact", 0)).toBeNull();
    expect(artifactPrice("zyw2", 6)).toBeNull();
  });

  it("has no price fallback when the live index cannot be loaded", async () => {
    clearPricingIndex();
    const error = await loadPricingIndex(async () => new Response("offline", { status: 503 })).catch((reason) => reason);
    expect(pricingErrorCode(error)).toBe("pricing_download_failed");
    expect(error).toHaveProperty("message", expect.stringContaining("HTTP 503"));
    expect(pricingRegionAvailable("eu")).toBe(false);
    expect(artifactPrice("zyw2", 0)).toBeNull();
  });

  it("classifies malformed market data without exposing it as a download failure", async () => {
    clearPricingIndex();
    const invalidJson = await loadPricingIndex(async () => new Response("not json")).catch((reason) => reason);
    expect(pricingErrorCode(invalidJson)).toBe("pricing_invalid_data");

    clearPricingIndex();
    const invalidSchema = await loadPricingIndex(async () => new Response(JSON.stringify({ schemaVersion: 2 }))).catch((reason) => reason);
    expect(pricingErrorCode(invalidSchema)).toBe("pricing_invalid_data");
  });

  it("rejects incomplete regional metadata and malformed estimates", () => {
    const cases: Array<[string, (bundle: any) => void]> = [
      ["empty snapshot", (bundle) => { bundle.regions.eu.snapshot = "  "; }],
      ["empty method", (bundle) => { bundle.regions.eu.method = ""; }],
      ["invalid as-of", (bundle) => { bundle.regions.eu.sourceWindow.asOf = "not a date"; }],
      ["missing cutoff", (bundle) => { delete bundle.regions.eu.sourceWindow.cutoff; }],
      ["invalid cutoff", (bundle) => { bundle.regions.eu.sourceWindow.cutoff = "not a date"; }],
      ["cutoff at as-of", (bundle) => { bundle.regions.eu.sourceWindow.cutoff = bundle.regions.eu.sourceWindow.asOf; }],
      ["string days", (bundle) => { bundle.regions.eu.sourceWindow.days = "365"; }],
      ["fractional days", (bundle) => { bundle.regions.eu.sourceWindow.days = 1.5; }],
      ["non-positive days", (bundle) => { bundle.regions.eu.sourceWindow.days = 0; }],
      ["invalid median", (bundle) => { bundle.regions.eu.artifacts.zyw2[0].median = "100"; }],
      ["invalid samples", (bundle) => { bundle.regions.eu.artifacts.zyw2[0].samples = 1.5; }],
      ["invalid condition", (bundle) => { bundle.regions.eu.artifacts.zyw2[0].condition = "unknown"; }],
      ["invalid confidence", (bundle) => { bundle.regions.eu.artifacts.zyw2[0].confidence = "unknown"; }],
      ["invalid weighted", (bundle) => { bundle.regions.eu.artifacts.zyw2[0].weighted = 0; }],
      ["invalid estimate window", (bundle) => { bundle.regions.eu.artifacts.zyw2[0].windowDays = 0; }],
      ["invalid recent samples", (bundle) => { bundle.regions.eu.artifacts.zyw2[0].recent90Samples = 6; }],
      ["invalid recent samples type", (bundle) => { bundle.regions.eu.artifacts.zyw2[0].recent90Samples = "4"; }],
      ["invalid anchor rarity", (bundle) => { bundle.regions.eu.artifacts.zyw2[1].anchorRarity = 6; }],
      ["invalid anchor name", (bundle) => { bundle.regions.eu.artifacts.zyw2[1].anchorRarityName = " "; }],
      ["invalid anchor price", (bundle) => { bundle.regions.eu.artifacts.zyw2[1].anchorPrice = 0; }],
      ["invalid multiplier", (bundle) => { bundle.regions.eu.artifacts.zyw2[1].multiplier = Infinity; }],
    ];
    for (const [name, mutate] of cases) {
      const bundle = testPricingBundle();
      mutate(bundle);
      const error = (() => {
        try {
          validatePricingBundle(bundle);
          return null;
        } catch (reason) {
          return reason;
        }
      })();
      expect(pricingErrorCode(error), name).toBe("pricing_invalid_data");
    }
  });

  it("accepts optional estimate fields and ignores unknown forward-compatible fields", () => {
    expect(() => validatePricingBundle(testPricingBundle())).not.toThrow();
  });

  it("shares one download and reuses the validated index for the page session", async () => {
    clearPricingIndex();
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return new Response(JSON.stringify(testPricingBundle()));
    };

    await Promise.all([loadPricingIndex(fetchImpl), loadPricingIndex(fetchImpl)]);
    await loadPricingIndex(fetchImpl);

    expect(requests).toBe(1);
    expect(artifactPrice("zyw2", 0)?.median).toBe(100);
  });

  it("formats ruble estimates and unavailable values", () => {
    expect(formatPrice(12_345.5)).toBe("12,346 ₽");
    expect(formatPrice(null)).toBe("Price unavailable");
  });

  it("labels direct, extrapolated, and unavailable prices consistently", () => {
    const market: PriceEstimate = {
      median: 100,
      samples: 12,
      condition: "build-equivalent",
      confidence: "medium",
      weighted: true,
      windowDays: 365,
    };
    const estimated: PriceEstimate = {
      median: 188,
      samples: 0,
      condition: "adjacent-extrapolated",
      confidence: "estimated",
      weighted: false,
      windowDays: 365,
      anchorRarityName: "Ordinary",
      multiplier: 1.88,
    };

    expect([priceSource(market), priceSource(estimated), priceSource(null)]).toEqual([
      "market",
      "estimated",
      "unknown",
    ]);
    expect([priceSourceLabel(market), priceSourceLabel(estimated), priceSourceLabel(null)]).toEqual([
      "Market",
      "Estimated",
      "Unknown",
    ]);
    expect(priceSourceDetails(market)).toContain("recency-weighted median from 12 eligible completed sales");
    expect(priceSourceDetails(estimated)).toContain("Ordinary price using 1.88× multiplier");
    expect(priceSourceDetails(null)).toContain("No eligible completed-sale estimate");
    expect(priceSourceDetails(null, "ru")).toContain("RU");
  });

  it("localizes price numbers, dates, and source details", async () => {
    await i18n.changeLanguage("ru");
    const market: PriceEstimate = {
      median: 12_345.5,
      samples: 12,
      condition: "build-equivalent",
      confidence: "medium",
      weighted: true,
      windowDays: 365,
    };
    expect(formatPrice(market.median)).toBe("12 346 ₽");
    expect(priceSourceLabel(market)).toBe("Рыночная");
    expect(priceSourceDetails(market)).toContain("подходящих завершённых продаж");
    expect(pricingMetadata("eu").asOfLabel).toMatch(/[а-я]/i);
  });
});

function testPricingBundle() {
  return {
    schemaVersion: 1,
    defaultRegion: "eu",
    regions: {
      eu: {
        region: "eu",
        snapshot: "test",
        method: "test",
        sourceWindow: { asOf: "2026-08-01T00:00:00.000Z", cutoff: "2025-08-01T00:00:00.000Z", days: 365 },
        artifacts: {
          zyw2: {
            0: { median: 100, samples: 5, recent90Samples: 4, condition: "build-equivalent", confidence: "medium", weighted: false, windowDays: 365, futureField: "ignored" },
            1: { median: 188, samples: 0, condition: "adjacent-extrapolated", confidence: "estimated", weighted: false, windowDays: 365, anchorRarity: 0, anchorRarityName: "Ordinary", anchorPrice: 100, multiplier: 1.88 },
          },
        },
      },
    },
  };
}
