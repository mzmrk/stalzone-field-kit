import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en";
import { ru } from "./locales/ru";

export const SUPPORTED_LANGUAGES = ["en", "ru"] as const;
export type AppLanguage = typeof SUPPORTED_LANGUAGES[number];
export const LANGUAGE_STORAGE_KEY = "field-kit-language-v1";

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return value !== undefined && value !== null && SUPPORTED_LANGUAGES.includes(value as AppLanguage);
}

export function preferredLanguage(
  savedLanguage: string | null = readSavedLanguage(),
  browserLanguages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages,
): AppLanguage {
  if (isAppLanguage(savedLanguage)) return savedLanguage;
  return browserLanguages.some((language) => language.toLowerCase().startsWith("ru")) ? "ru" : "en";
}

export function appLanguage(value = i18n.resolvedLanguage ?? i18n.language): AppLanguage {
  return value.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function appLocale(language = appLanguage()) {
  return language === "ru" ? "ru-RU" : "en-US";
}

function readSavedLanguage() {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY); } catch { return null; }
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru } },
  lng: preferredLanguage(),
  fallbackLng: "en",
  supportedLngs: SUPPORTED_LANGUAGES,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
