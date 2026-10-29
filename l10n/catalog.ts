// The shape of what l10n/build.ts and l10n/languages.ts generate files from. It sits below
// both so that neither imports the other.

import type { SourceString } from "./strings";

/** Strings and languages to build: strings.ts and locales.ts, or a test's own. */
export interface Catalog {
  readonly strings: Readonly<Record<string, SourceString>>;
  readonly locales: readonly [CatalogLocale, ...CatalogLocale[]];
}

export interface CatalogLocale {
  readonly tag: string;
  readonly nativeName?: string;
  readonly direction?: "ltr" | "rtl";
  readonly appStore: readonly string[];
  readonly play: readonly string[];
  readonly translation?: Readonly<Record<string, string>>;
}
