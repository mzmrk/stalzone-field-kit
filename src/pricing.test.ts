import { afterEach, describe, expect, it } from "vitest";
import i18n from "./i18n";
import {
  artifactId,
  artifactPrice,
  DEFAULT_PRICING_REGION,
  formatPrice,
  pricingMetadata,
  pricingRegionAvailable,
  PRICING_REGIONS,
  priceSource,
  priceSourceDetails,
  priceSourceLabel,
  type PriceEstimate,
} from "./pricing";

describe("auction pricing", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });
  it("extracts opaque EXBO artifact IDs from listing paths", () => {
    expect(artifactId("/items/artefact/thermal/zyw2.json")).toBe("zyw2");
    expect(artifactId("zyw2")).toBe("zyw2");
  });

  it("returns the generated median and sample count for a rarity tier", () => {
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
