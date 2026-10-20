import { languagePreference, type LanguagePreference } from "../../l10n/locales";

export const LANGUAGE_KEY = "language";
export function readLanguage(): LanguagePreference {
  try { return languagePreference(localStorage.getItem(LANGUAGE_KEY)); }
  catch { return "device"; }
}
export function saveLanguage(value: LanguagePreference): boolean {
  try { localStorage.setItem(LANGUAGE_KEY, value); return true; }
  catch { return false; }
}
