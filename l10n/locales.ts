// The languages the apps and their store listings are in. To add one, write its
// translation as l10n/<tag>.ts (`export default { ... } satisfies Translation`), list it
// here, add its store listings under fastlane/metadata/, and run `bun run l10n`.

import de from "./de";
import es from "./es";
import { STRINGS, type StringKey, type Translation } from "./strings";

export interface Locale {
  /** BCP 47 tag that Android, iOS, and browsers match against the user's languages: "de", "pt-BR", "zh-Hans". */
  readonly tag: string;
  /** App Store Connect's codes for it, each naming a listing's folder in fastlane/metadata/ios. */
  readonly appStore: readonly string[];
  /** Google Play's codes for it, each naming a listing's folder in fastlane/metadata/android. */
  readonly play: readonly string[];
  /** Its text. English, the source language, has none: its text is in strings.ts. */
  readonly translation?: Translation;
}

/** English first, then each translation. */
export const LOCALES: readonly [Locale, ...Locale[]] = [
  { tag: "en", appStore: ["en-US"], play: ["en-US"] },
  { tag: "de", appStore: ["de-DE"], play: ["de-DE"], translation: de },
  // The stores list Spain's Spanish and Latin America's separately; one translation serves both.
  { tag: "es", appStore: ["es-ES", "es-MX"], play: ["es-ES", "es-419"], translation: es },
];

/** `key`'s text in `locale`, placeholders and all: its translation, or English for a name that isn't translated. */
export function localeText(locale: Locale, key: StringKey): string {
  const translation: Readonly<Partial<Record<StringKey, string>>> | undefined = locale.translation;
  return translation?.[key] ?? STRINGS[key].text;
}
