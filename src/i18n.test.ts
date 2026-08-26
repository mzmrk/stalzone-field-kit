import { afterEach, describe, expect, it } from "vitest";
import i18n, { appLanguage, appLocale, preferredLanguage } from "./i18n";
import { translated } from "./data";

describe("language selection", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("prefers an explicit saved choice over browser languages", () => {
    expect(preferredLanguage("en", ["ru-RU"])).toBe("en");
    expect(preferredLanguage("ru", ["en-US"])).toBe("ru");
  });

  it("uses Russian when any browser preference is Russian and otherwise falls back to English", () => {
    expect(preferredLanguage(null, ["pl-PL", "ru-RU", "en-US"])).toBe("ru");
    expect(preferredLanguage(null, ["pl-PL", "en-US"])).toBe("en");
  });

  it("switches official EXBO names and locale formatting without reloading", async () => {
    const name = { lines: { en: "Bracelet", ru: "Браслет" } };
    await i18n.changeLanguage("ru");
    expect(appLanguage()).toBe("ru");
    expect(appLocale()).toBe("ru-RU");
    expect(translated(name)).toBe("Браслет");
    expect(i18n.t("Movement speed")).toBe("Скорость передвижения");

    await i18n.changeLanguage("en");
    expect(translated(name)).toBe("Bracelet");
  });
});
