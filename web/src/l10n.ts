// The web app's strings, from l10n/, in the language that best matches the browser's.

import { LOCALES, type Locale, localeText } from "../../l10n/locales";
import { PLACEHOLDER, type Placeholders, type PlatformKey, type STRINGS } from "../../l10n/strings";

/** The keys of the strings the web app shows. */
export type WebKey = PlatformKey<"web">;

/** Values for `K`'s placeholders, if it has any: `t("play_noise", { noise })`. */
export type Params<K extends WebKey> = K extends WebKey
  ? [Placeholders<(typeof STRINGS)[K]["text"]>] extends [never]
    ? []
    : [params: Readonly<Record<Placeholders<(typeof STRINGS)[K]["text"]>, string>>]
  : never;

let current: Locale = LOCALES[0];

/** The language the page is shown in. */
export function currentLocale(): Locale {
  return current;
}

/** Shows text in the language that best matches `preferred` from now on (see bestLocale). */
export function setPreferredLanguages(preferred: readonly string[], locales: readonly [Locale, ...Locale[]] = LOCALES): void {
  current = bestLocale(preferred, locales);
}

/** `key`'s text in the current language, with its placeholders filled in. */
export function t<K extends WebKey>(key: K, ...params: Params<K>): string {
  const values: Readonly<Record<string, string>> = params[0] ?? {};
  return localeText(current, key).replace(PLACEHOLDER, (placeholder, name: string) => values[name] ?? placeholder);
}

/**
 * The locale for the first of `preferred` (the user's languages, most preferred first, as
 * in navigator.languages) that one matches, or English. Likely scripts and regions are
 * filled in before comparing, so "de-AT" matches "de", and "zh-TW" matches "zh-Hant" but
 * not "zh-Hans". A locale with the same region wins over one with only the same language.
 */
export function bestLocale(preferred: readonly string[], locales: readonly [Locale, ...Locale[]] = LOCALES): Locale {
  const supported = locales.map((locale) => ({ locale, full: new Intl.Locale(locale.tag).maximize() }));
  for (const tag of preferred) {
    let wanted: Intl.Locale;
    try {
      wanted = new Intl.Locale(tag).maximize();
    } catch {
      continue;
    }
    const match =
      supported.find(({ full }) => full.baseName === wanted.baseName) ??
      supported.find(({ full }) => full.language === wanted.language && full.script === wanted.script);
    if (match !== undefined) return match.locale;
  }
  return locales[0];
}
