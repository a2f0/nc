import { LOCALES } from "./locales";
import { STRINGS, type SourceString } from "./strings";
import { render, validate, listingErrors, swiftKeyErrors, outOfDate } from "./build";
import { join } from "node:path";

/** Read-only rollout inventory. Structural completeness isn't human translation approval. */
export async function report(root = join(import.meta.dir, "..")) {
  const catalog = { strings: STRINGS, locales: LOCALES };
  const source: Record<string, SourceString> = STRINGS;
  const translatedKeys = Object.keys(source).filter(key => source[key]!.translatable !== false);
  const generated = render(catalog);
  const stale = await outOfDate(root, generated);
  const errors = [...validate(catalog), ...await listingErrors(root, catalog), ...await swiftKeyErrors(root, catalog)];
  return {
    locales: LOCALES.map(locale => ({
      tag: locale.tag, name: locale.nativeName, direction: locale.direction,
      translated: locale.tag === "en" ? translatedKeys.length : Object.keys(locale.translation).length,
      required: translatedKeys.length,
      stores: { ios: locale.appStore, android: locale.play },
    })),
    strings: Object.keys(source).length,
    generated: [...generated.keys()],
    outOfDate: [...stale.changed, ...stale.removed],
    errors,
    reviewRequired: ["Native-speaker wording", "Small-screen layout and accessibility", "Plural rules for future count messages", "Localized store screenshots and support pages"],
  };
}

if (import.meta.main) {
  const result = await report();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length || result.outOfDate.length) process.exitCode = 1;
}
