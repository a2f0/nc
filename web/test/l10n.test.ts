import { afterEach, describe, expect, test } from "bun:test";
import type { Locale } from "../../l10n/locales";
import type { Translation } from "../../l10n/strings";
import { bestLocale, currentLocale, setPreferredLanguages, t } from "../src/l10n";

// Only the tags matter for matching.
const locale = (tag: string): Locale => ({ tag, appStore: [tag], play: [tag] });
const EN = locale("en");
const DE = locale("de");
const PT_BR = locale("pt-BR");
const PT_PT = locale("pt-PT");
const ZH_HANS = locale("zh-Hans");
const ZH_HANT = locale("zh-Hant");
const LOCALES = [EN, DE, PT_BR, PT_PT, ZH_HANS, ZH_HANT] as const;

describe("bestLocale", () => {
  test("matches the first preferred language the apps are in", () => {
    expect(bestLocale(["fr-FR", "de-AT", "en-US"], LOCALES)).toBe(DE);
    expect(bestLocale(["en-GB", "de"], LOCALES)).toBe(EN);
  });

  test("prefers the same region, then the language's most likely one", () => {
    expect(bestLocale(["pt-PT"], LOCALES)).toBe(PT_PT);
    expect(bestLocale(["pt"], LOCALES)).toBe(PT_BR);
    expect(bestLocale(["pt-AO"], LOCALES)).toBe(PT_BR);
  });

  test("matches scripts, not just languages", () => {
    expect(bestLocale(["zh-CN"], LOCALES)).toBe(ZH_HANS);
    expect(bestLocale(["zh-TW"], LOCALES)).toBe(ZH_HANT);
    expect(bestLocale(["zh-HK"], LOCALES)).toBe(ZH_HANT);
    expect(bestLocale(["sr-Latn"], [EN, locale("sr")])).toBe(EN);
  });

  test("falls back to English", () => {
    expect(bestLocale([], LOCALES)).toBe(EN);
    expect(bestLocale(["fr", "not a tag"], LOCALES)).toBe(EN);
  });
});

describe("t", () => {
  afterEach(() => setPreferredLanguages([]));

  test("fills in placeholders", () => {
    expect(t("stop_noise", { noise: t("noise_pink_title") })).toBe("Stop Pink Noise");
    expect(t("play_noise", { noise: "White Noise" })).toBe("Play White Noise");
  });

  test("shows English for languages the apps aren't in", () => {
    setPreferredLanguages(["fr-FR"]);
    expect(currentLocale().tag).toBe("en");
    expect(t("volume")).toBe("Volume");
  });

  test("a translation's text, with its placeholders in its own order", () => {
    const translation = { play_noise: "{noise} abspielen", volume: "Lautstärke" } as Partial<Translation> as Translation;
    setPreferredLanguages(["de-CH"], [EN, { ...DE, translation }]);
    expect(currentLocale().tag).toBe("de");
    expect(t("play_noise", { noise: "Rosa Rauschen" })).toBe("Rosa Rauschen abspielen");
    expect(t("volume")).toBe("Lautstärke");
    expect(t("app_name")).toBe("Noise Connoisseur");
  });
});
