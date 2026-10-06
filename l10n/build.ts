// Writes each platform's native string files from strings.ts and the translations in
// locales.ts, after checking them, and checks the store listings and iOS's literal string
// keys against them. With --check it writes nothing, and fails if a generated file is out
// of date. The web app needs no files: it imports strings.ts and locales.ts.

import { mkdir, readdir, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LOCALES } from "./locales";
import { PLACEHOLDER, type Platform, type SourceString, STRINGS } from "./strings";

const REPO_ROOT = join(import.meta.dir, "..");
const ANDROID_RES = "android/app/src/main/res";
const IOS_CATALOG = "ios/Shared/Localizable.xcstrings";
const NOTICE = "Generated from l10n/ by `bun run l10n`; edit those files instead.";

/** Strings and languages to build: strings.ts and locales.ts, or a test's own. */
export interface Catalog {
  readonly strings: Readonly<Record<string, SourceString>>;
  readonly locales: readonly [CatalogLocale, ...CatalogLocale[]];
}

interface CatalogLocale {
  readonly tag: string;
  readonly appStore: readonly string[];
  readonly play: readonly string[];
  readonly translation?: Readonly<Record<string, string>>;
}

// MARK: - Checking

/** What's wrong with the strings and translations, if anything. Rendering assumes nothing is. */
export function validate({ strings, locales }: Catalog): string[] {
  const errors: string[] = [];
  const [source, ...translations] = locales;

  const tags = new Set<string>();
  const storeCodes = new Set<string>();
  for (const { tag, appStore, play } of locales) {
    if (!isSimpleTag(tag)) errors.push(`Locale "${tag}" isn't a canonical BCP 47 language, script, and region, such as "de", "pt-BR", or "zh-Hans".`);
    if (tags.has(tag)) errors.push(`Locale "${tag}" is listed twice.`);
    tags.add(tag);
    if (appStore.length === 0 || play.length === 0) errors.push(`Locale "${tag}" needs App Store and Google Play codes.`);
    for (const code of [...appStore.map((code) => `App Store ${code}`), ...play.map((code) => `Google Play ${code}`)]) {
      if (storeCodes.has(code)) errors.push(`${code} is listed for more than one locale.`);
      storeCodes.add(code);
    }
  }
  if (source.translation !== undefined) errors.push(`The first locale, "${source.tag}", is English: its text is in strings.ts, not a translation.`);

  for (const [key, entry] of Object.entries(strings)) {
    if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(key)) errors.push(`${key}: keys are snake_case, as Android resource names.`);
    if (entry.comment.trim() === "") errors.push(`${key}: needs a comment for translators.`);
    if (entry.comment.includes("--")) errors.push(`${key}: comments can't contain "--", which ends an XML comment.`);
    if (entry.platforms?.length === 0) errors.push(`${key}: shows on no platform.`);
    errors.push(...textErrors(`${key} (${source.tag})`, entry.text));
  }

  for (const { tag, translation } of translations) {
    if (translation === undefined) {
      errors.push(`Locale "${tag}" has no translation.`);
      continue;
    }
    for (const [key, entry] of Object.entries(strings)) {
      const text = translation[key];
      if (entry.translatable === false) {
        if (text !== undefined) errors.push(`${key} (${tag}): isn't translatable.`);
      } else if (text === undefined) {
        errors.push(`${key} (${tag}): missing.`);
      } else {
        errors.push(...textErrors(`${key} (${tag})`, text));
        const expected = placeholders(entry.text).sort().join(", ");
        const actual = placeholders(text).sort().join(", ");
        if (actual !== expected) errors.push(`${key} (${tag}): has placeholders [${actual}]; English has [${expected}].`);
      }
    }
    for (const key of Object.keys(translation)) {
      if (!(key in strings)) errors.push(`${key} (${tag}): isn't in strings.ts.`);
    }
  }
  return errors;
}

function isSimpleTag(tag: string): boolean {
  try {
    const { language, script, region } = new Intl.Locale(tag);
    return Intl.getCanonicalLocales(tag)[0] === tag && [language, script, region].filter(Boolean).join("-") === tag;
  } catch {
    return false;
  }
}

function textErrors(where: string, text: string): string[] {
  const errors: string[] = [];
  if (text === "" || text.trim() !== text) errors.push(`${where}: is empty, or starts or ends with whitespace.`);
  if (text.includes("%")) errors.push(`${where}: has a "%", which Android and iOS would read as a format specifier.`);
  if (/[{}]/.test(text.replace(PLACEHOLDER, ""))) errors.push(`${where}: has a brace that isn't part of a {placeholder}.`);
  return errors;
}

/** The names of `text`'s placeholders, in the order they first appear. */
function placeholders(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(PLACEHOLDER), (match) => match[1] ?? ""))];
}

function shows(entry: SourceString, platform: Platform): boolean {
  return entry.platforms?.includes(platform) ?? true;
}

/**
 * App Intents' metadata has to be built from `LocalizedStringResource("key")` literals,
 * not the generated symbols, so the compiler can't check those keys. This does.
 */
export async function swiftKeyErrors(root: string, { strings }: Catalog): Promise<string[]> {
  const keys = new Set(Object.keys(strings).filter((key) => shows(strings[key]!, "ios")));
  const errors: string[] = [];
  for await (const file of new Bun.Glob("ios/**/*.swift").scan({ cwd: root })) {
    if (file.startsWith("ios/build/")) continue;
    const source = await Bun.file(join(root, file)).text();
    for (const [, key = ""] of source.matchAll(/LocalizedStringResource\("([^"]*)"/g)) {
      if (!keys.has(key)) errors.push(`${file}: LocalizedStringResource("${key}") isn't an iOS string in l10n/strings.ts.`);
    }
  }
  return errors.sort();
}

/** The stores' limits, in characters, on the listing fields that have one. */
const LISTING_LIMITS = {
  ios: { "name.txt": 30, "subtitle.txt": 30, "promotional_text.txt": 170, "keywords.txt": 100, "description.txt": 4000 },
  android: { "title.txt": 30, "short_description.txt": 80, "full_description.txt": 4000 },
} as const satisfies Record<string, Record<string, number>>;

/** Folders in fastlane/metadata/ios that aren't locales. */
const NON_LOCALE_FOLDERS = new Set(["review_information"]);

/**
 * Each locale needs a store listing, with the same fields as English's, within the
 * stores' limits; and each listing needs a locale, or its store page would promise a
 * language the app isn't in.
 */
export async function listingErrors(root: string, { locales }: Catalog): Promise<string[]> {
  const errors: string[] = [];
  for (const store of ["ios", "android"] as const) {
    const dir = `fastlane/metadata/${store}`;
    const codes = locales.flatMap((locale) => (store === "ios" ? locale.appStore : locale.play));
    const folders = (await readdir(join(root, dir), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !NON_LOCALE_FOLDERS.has(entry.name))
      .map((entry) => entry.name);
    for (const folder of folders) {
      if (!codes.includes(folder)) errors.push(`${dir}/${folder}: isn't the listing of a locale in l10n/locales.ts.`);
    }

    const sourceFields = await textFiles(join(root, dir, codes[0]!));
    for (const code of codes) {
      if (!folders.includes(code)) {
        errors.push(`${dir}/${code}: missing; every locale in l10n/locales.ts needs a store listing.`);
        continue;
      }
      const fields = await textFiles(join(root, dir, code));
      for (const field of sourceFields) {
        if (!fields.includes(field)) errors.push(`${dir}/${code}/${field}: missing; ${codes[0]} has it.`);
      }
      for (const field of fields) {
        const text = (await Bun.file(join(root, dir, code, field)).text()).trim();
        const limit: number | undefined = (LISTING_LIMITS[store] as Record<string, number>)[field];
        const length = [...text].length;
        if (text === "") errors.push(`${dir}/${code}/${field}: is empty.`);
        if (limit !== undefined && length > limit) errors.push(`${dir}/${code}/${field}: is ${length} characters; the limit is ${limit}.`);
      }
    }
  }
  return errors;
}

async function textFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".txt")).map((entry) => entry.name).sort();
}

// MARK: - Rendering

/** Every generated file's contents, by its path from the repository root. */
export function render(catalog: Catalog): Map<string, string> {
  const files = new Map<string, string>();
  for (const locale of catalog.locales) {
    files.set(androidStringsPath(catalog, locale), androidStrings(catalog, locale));
  }
  files.set(`${ANDROID_RES}/resources.properties`, androidResourcesProperties(catalog));
  files.set(IOS_CATALOG, xcstrings(catalog));
  return files;
}

function androidStringsPath({ locales }: Catalog, locale: CatalogLocale): string {
  const folder = locale === locales[0] ? "values" : `values-${androidQualifier(locale.tag)}`;
  return `${ANDROID_RES}/${folder}/strings.xml`;
}

/** The resource qualifier for a tag: "de", "pt-rBR", or, with a script or a numeric region, "b+zh+Hans". */
export function androidQualifier(tag: string): string {
  const { language, script, region } = new Intl.Locale(tag);
  if (script === undefined && (region === undefined || /^[A-Z]{2}$/.test(region))) {
    return region === undefined ? language : `${language}-r${region}`;
  }
  return ["b", language, script, region].filter((part) => part !== undefined).join("+");
}

function androidStrings({ strings, locales }: Catalog, locale: CatalogLocale): string {
  const isSource = locale === locales[0];
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', `<!-- ${NOTICE} -->`, "<resources>"];
  for (const [key, entry] of Object.entries(strings)) {
    if (!shows(entry, "android")) continue;
    if (isSource) {
      const attributes = entry.translatable === false ? ' translatable="false"' : "";
      lines.push(`    <!-- ${entry.comment} -->`);
      lines.push(`    <string name="${key}"${attributes}>${androidText(entry.text, entry.text)}</string>`);
    } else if (entry.translatable !== false) {
      lines.push(`    <string name="${key}">${androidText(locale.translation?.[key] ?? "", entry.text)}</string>`);
    }
  }
  lines.push("</resources>", "");
  return lines.join("\n");
}

/** `text` as an Android string resource, its placeholders numbered as they first appear in `source`. */
export function androidText(text: string, source: string): string {
  const order = placeholders(source);
  return text
    .replace(/[\\'"]/g, (char) => `\\${char}`)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\n/g, "\\n")
    .replace(/^[@?]/, (char) => `\\${char}`)
    .replace(PLACEHOLDER, (_, name: string) => `%${order.indexOf(name) + 1}$s`);
}

/**
 * The language of the unqualified values/ folder, which the Android Gradle plugin needs
 * to build the per-app language setting's list (generateLocaleConfig).
 */
function androidResourcesProperties({ locales }: Catalog): string {
  return `# ${NOTICE}\nunqualifiedResLocale=${locales[0].tag}\n`;
}

/**
 * A String Catalog of manually defined strings, for which Xcode generates symbols
 * (STRING_CATALOG_GENERATE_SYMBOLS): `Text(.volume)`, `.statusPlaying(title)`. Names have
 * their English in every language, since iOS shows the key, not English, for a string
 * that the user's language is missing.
 */
function xcstrings({ strings, locales }: Catalog): string {
  const [source] = locales;
  const entries: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(strings)) {
    if (!shows(entry, "ios")) continue;
    const translatable = entry.translatable !== false;
    const localizations: Record<string, unknown> = {};
    for (const locale of locales) {
      const text = locale === source || !translatable ? entry.text : (locale.translation?.[key] ?? "");
      localizations[locale.tag] = { stringUnit: { state: "translated", value: iosText(text, entry.text) } };
    }
    entries[key] = {
      comment: entry.comment,
      extractionState: "manual",
      localizations,
      ...(translatable ? {} : { shouldTranslate: false }),
    };
  }
  return xcodeJson({ sourceLanguage: source.tag, strings: entries, version: "1.0" });
}

/** `text` as an iOS format string, its placeholders numbered as they first appear in `source`. */
export function iosText(text: string, source: string): string {
  const order = placeholders(source);
  return text.replace(PLACEHOLDER, (_, name: string) => `%${order.indexOf(name) + 1}$@`);
}

/** JSON as Xcode writes String Catalogs, so opening one in Xcode doesn't reformat it. */
function xcodeJson(value: unknown, indent = ""): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = `${indent}  `;
  const object = value as Record<string, unknown>;
  const members = Object.keys(object)
    .sort()
    .map((key) => `${inner}${JSON.stringify(key)} : ${xcodeJson(object[key], inner)}`);
  return `{\n${members.join(",\n")}\n${indent}}`;
}

// MARK: - Writing

/** Generated files that differ from what's on disk, and strings files that are no longer generated. */
export async function outOfDate(root: string, files: ReadonlyMap<string, string>): Promise<{ changed: string[]; removed: string[] }> {
  const changed: string[] = [];
  for (const [path, contents] of files) {
    const file = Bun.file(join(root, path));
    if (!(await file.exists()) || (await file.text()) !== contents) changed.push(path);
  }
  const removed: string[] = [];
  for await (const path of new Bun.Glob(`${ANDROID_RES}/values*/strings.xml`).scan({ cwd: root })) {
    if (!files.has(path)) removed.push(path);
  }
  return { changed, removed: removed.sort() };
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const catalog: Catalog = { strings: STRINGS, locales: LOCALES };
  let errors = validate(catalog);
  if (errors.length === 0) {
    errors = [...(await swiftKeyErrors(REPO_ROOT, catalog)), ...(await listingErrors(REPO_ROOT, catalog))];
  }
  if (errors.length > 0) {
    console.error(errors.map((error) => `l10n: ${error}`).join("\n"));
    process.exit(1);
  }

  const files = render(catalog);
  const { changed, removed } = await outOfDate(REPO_ROOT, files);
  if (check) {
    if (changed.length > 0 || removed.length > 0) {
      console.error(`l10n: out of date: ${[...changed, ...removed].join(", ")}. Run bun run l10n.`);
      process.exit(1);
    }
  } else {
    for (const path of changed) {
      await mkdir(dirname(join(REPO_ROOT, path)), { recursive: true });
      await Bun.write(join(REPO_ROOT, path), files.get(path) ?? "");
      console.log(`Wrote ${path}`);
    }
    for (const path of removed) {
      await rm(join(REPO_ROOT, path));
      await rmdir(dirname(join(REPO_ROOT, path))).catch(() => {});
      console.log(`Removed ${path}`);
    }
    if (changed.length === 0 && removed.length === 0) console.log("Up to date.");
  }
}
