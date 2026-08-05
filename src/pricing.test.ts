import { describe, expect, it } from "vitest";
import { artifactId, artifactPrice, formatPrice } from "./pricing";

describe("auction pricing", () => {
  it("extracts opaque EXBO artifact IDs from listing paths", () => {
    expect(artifactId("/items/artefact/thermal/zyw2.json")).toBe("zyw2");
    expect(artifactId("zyw2")).toBe("zyw2");
  });

  it("returns the generated median and sample count for a rarity tier", () => {
    const ordinary = artifactPrice("zyw2", 0);
    expect(ordinary?.median).toBeGreaterThan(0);
    expect(ordinary?.samples).toBeGreaterThan(0);
  });

  it("does not substitute another rarity when market data is unavailable", () => {
    expect(artifactPrice("missing-artifact", 0)).toBeNull();
    expect(artifactPrice("zyw2", 6)).toBeNull();
  });

  it("formats ruble estimates and unavailable values", () => {
    expect(formatPrice(12_345.5)).toBe("12,346 ₽");
    expect(formatPrice(null)).toBe("Price unavailable");
  });
});
