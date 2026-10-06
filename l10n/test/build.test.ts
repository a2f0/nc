import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  androidQualifier,
  androidText,
  type Catalog,
  iosText,
  listingErrors,
  outOfDate,
  render,
  swiftKeyErrors,
  validate,
} from "../build";
import { LOCALES } from "../locales";
import { STRINGS } from "../strings";

const EN = { tag: "en", appStore: ["en-US"], play: ["en-US"] };
const DE = { tag: "de", appStore: ["de-DE"], play: ["de-DE"] };

const catalog: Catalog = {
  strings: {
    app_name: { text: "Noise", comment: "The name.", translatable: false },
    status: { text: "{noise} at {level}", comment: "Status." },
    stop: { text: "Stop", comment: "Notification button.", platforms: ["android"] },
    intent: { text: "Play", comment: "Shortcuts action.", platforms: ["ios"] },
  },
  locales: [EN, { ...DE, translation: { status: "{level}: {noise}", stop: "Stopp", intent: "Abspielen" } }],
};

describe("validate", () => {
  test("the apps' strings and translations are valid", () => {
    expect(validate({ strings: STRINGS, locales: LOCALES })).toEqual([]);
    expect(validate(catalog)).toEqual([]);
  });

  test("translations have every translatable string, and nothing else", () => {
    const errors = validate({
      strings: catalog.strings,
      locales: [EN, { ...DE, translation: { app_name: "Rauschen", status: "{level}: {noise}", intent: "Abspielen", extra: "Mehr" } }],
    });
    expect(errors).toEqual(["app_name (de): isn't translatable.", "stop (de): missing.", "extra (de): isn't in strings.ts."]);
  });

  test("translations keep exactly the English placeholders", () => {
    const errors = validate({
      strings: catalog.strings,
      locales: [EN, { ...DE, translation: { status: "{noise} bei {volume}", stop: "Stopp", intent: "Abspielen" } }],
    });
    expect(errors).toEqual(["status (de): has placeholders [noise, volume]; English has [level, noise]."]);
  });

  test("text that the platforms would misread is rejected", () => {
    const errors = validate({
      strings: {
        percent: { text: "100%", comment: "c" },
        brace: { text: "a {b", comment: "c" },
        padded: { text: " a", comment: "c" },
        Bad_Key: { text: "a", comment: "c" },
        dashes: { text: "a", comment: "a -- b" },
      },
      locales: [EN],
    });
    expect(errors).toEqual([
      `percent (en): has a "%", which Android and iOS would read as a format specifier.`,
      "brace (en): has a brace that isn't part of a {placeholder}.",
      "padded (en): is empty, or starts or ends with whitespace.",
      "Bad_Key: keys are snake_case, as Android resource names.",
      `dashes: comments can't contain "--", which ends an XML comment.`,
    ]);
  });

  test("locales are canonical tags, with English first and a translation for each other one", () => {
    const errors = validate({
      strings: {},
      locales: [{ ...EN, translation: {} }, { ...DE }, { tag: "pt-br", appStore: ["pt-BR"], play: ["pt-BR"], translation: {} }],
    });
    expect(errors).toEqual([
      `Locale "pt-br" isn't a canonical BCP 47 language, script, and region, such as "de", "pt-BR", or "zh-Hans".`,
      `The first locale, "en", is English: its text is in strings.ts, not a translation.`,
      `Locale "de" has no translation.`,
    ]);
  });

  test("each locale has its own store codes", () => {
    const errors = validate({
      strings: {},
      locales: [EN, { tag: "de", appStore: ["de-DE", "en-US"], play: [], translation: {} }],
    });
    expect(errors).toEqual([`Locale "de" needs App Store and Google Play codes.`, "App Store en-US is listed for more than one locale."]);
  });
});

describe("rendering", () => {
  test("Android resources escape their text and number placeholders in English's order", () => {
    expect(androidText(`It's "5" & <b> \\ ok`, "")).toBe(`It\\'s \\"5\\" &amp; &lt;b> \\\\ ok`);
    expect(androidText("@home\nnext", "")).toBe("\\@home\\nnext");
    expect(androidText("{level}: {noise}", "{noise} at {level}")).toBe("%2$s: %1$s");
  });

  test("iOS format strings number placeholders in English's order", () => {
    expect(iosText("{level}: {noise}", "{noise} at {level}")).toBe("%2$@: %1$@");
    expect(iosText("Volume", "Volume")).toBe("Volume");
  });

  test("Android qualifiers", () => {
    expect(androidQualifier("de")).toBe("de");
    expect(androidQualifier("pt-BR")).toBe("pt-rBR");
    expect(androidQualifier("zh-Hans")).toBe("b+zh+Hans");
    expect(androidQualifier("es-419")).toBe("b+es+419");
  });

  test("each platform gets its own strings, and translations leave out names", () => {
    const files = render(catalog);
    expect([...files.keys()].sort()).toEqual([
      "android/app/src/main/res/resources.properties",
      "android/app/src/main/res/values-de/strings.xml",
      "android/app/src/main/res/values/strings.xml",
      "ios/Shared/Localizable.xcstrings",
    ]);

    const english = files.get("android/app/src/main/res/values/strings.xml");
    expect(english).toContain(`    <!-- The name. -->\n    <string name="app_name" translatable="false">Noise</string>`);
    expect(english).toContain(`<string name="status">%1$s at %2$s</string>`);
    expect(english).not.toContain("intent");
    const german = files.get("android/app/src/main/res/values-de/strings.xml") ?? "";
    expect(german.match(/<string .*/g)).toEqual([`<string name="status">%2$s: %1$s</string>`, `<string name="stop">Stopp</string>`]);
    expect(files.get("android/app/src/main/res/resources.properties")).toEndWith("\nunqualifiedResLocale=en\n");

    const xcstrings = files.get("ios/Shared/Localizable.xcstrings") ?? "";
    expect(xcstrings).toStartWith(`{\n  "sourceLanguage" : "en",\n  "strings" : {\n    "app_name" : {\n      "comment" : "The name.",`);
    expect(JSON.parse(xcstrings)).toEqual({
      sourceLanguage: "en",
      strings: {
        app_name: {
          comment: "The name.",
          extractionState: "manual",
          localizations: {
            de: { stringUnit: { state: "translated", value: "Noise" } },
            en: { stringUnit: { state: "translated", value: "Noise" } },
          },
          shouldTranslate: false,
        },
        intent: {
          comment: "Shortcuts action.",
          extractionState: "manual",
          localizations: {
            de: { stringUnit: { state: "translated", value: "Abspielen" } },
            en: { stringUnit: { state: "translated", value: "Play" } },
          },
        },
        status: {
          comment: "Status.",
          extractionState: "manual",
          localizations: {
            de: { stringUnit: { state: "translated", value: "%2$@: %1$@" } },
            en: { stringUnit: { state: "translated", value: "%1$@ at %2$@" } },
          },
        },
      },
      version: "1.0",
    });
  });
});

describe("repository checks", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "l10n-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(files: Record<string, string>): Promise<void> {
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), contents);
    }
  }

  test("iOS's literal keys must be iOS strings", async () => {
    await write({
      "ios/Shared/Intents.swift": `static let title = LocalizedStringResource("intent")\nlet a = LocalizedStringResource("stop")`,
      "ios/App/View.swift": `Text(LocalizedStringResource("typo"))`,
      "ios/build/Generated.swift": `LocalizedStringResource("ignored")`,
    });
    expect(await swiftKeyErrors(root, catalog)).toEqual([
      `ios/App/View.swift: LocalizedStringResource("typo") isn't an iOS string in l10n/strings.ts.`,
      `ios/Shared/Intents.swift: LocalizedStringResource("stop") isn't an iOS string in l10n/strings.ts.`,
    ]);
  });

  test("every locale has a complete store listing within the limits, and every listing has a locale", async () => {
    const spanish = { tag: "es", appStore: ["es-ES", "es-MX"], play: ["es-ES"], translation: {} };
    await write({
      "fastlane/metadata/ios/es-ES/name.txt": "Ruido\n",
      "fastlane/metadata/ios/es-ES/description.txt": "Ruido.\n",
      "fastlane/metadata/android/es-ES/title.txt": "Ruido\n",
      "fastlane/metadata/ios/en-US/name.txt": "Noise\n",
      "fastlane/metadata/ios/en-US/description.txt": "Noise.\n",
      "fastlane/metadata/ios/de-DE/name.txt": "Ein sehr, sehr langer Rauschname\n",
      "fastlane/metadata/ios/fr-FR/name.txt": "Bruit\n",
      "fastlane/metadata/ios/review_information/notes.txt": "Notes\n",
      "fastlane/metadata/ios/primary_category.txt": "MUSIC\n",
      "fastlane/metadata/android/en-US/title.txt": "Noise\n",
    });
    expect(await listingErrors(root, { ...catalog, locales: [...catalog.locales, spanish] })).toEqual([
      "fastlane/metadata/ios/fr-FR: isn't the listing of a locale in l10n/locales.ts.",
      "fastlane/metadata/ios/de-DE/description.txt: missing; en-US has it.",
      "fastlane/metadata/ios/de-DE/name.txt: is 32 characters; the limit is 30.",
      "fastlane/metadata/ios/es-MX: missing; every locale in l10n/locales.ts needs a store listing.",
      "fastlane/metadata/android/de-DE: missing; every locale in l10n/locales.ts needs a store listing.",
    ]);
  });

  test("generated files are compared with the disk, and stale strings files found", async () => {
    await write({
      "android/app/src/main/res/values/strings.xml": "old",
      "android/app/src/main/res/values-fr/strings.xml": "removed",
      "android/app/src/main/res/values/themes.xml": "not generated",
      "ios/Shared/Localizable.xcstrings": "current",
    });
    const files = new Map([
      ["android/app/src/main/res/values/strings.xml", "new"],
      ["android/app/src/main/res/values-de/strings.xml", "added"],
      ["ios/Shared/Localizable.xcstrings", "current"],
    ]);
    expect(await outOfDate(root, files)).toEqual({
      changed: ["android/app/src/main/res/values/strings.xml", "android/app/src/main/res/values-de/strings.xml"],
      removed: ["android/app/src/main/res/values-fr/strings.xml"],
    });
  });
});
