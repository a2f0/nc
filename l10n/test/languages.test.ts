import { expect, test } from "bun:test";
import { languageFiles } from "../languages";
import { languagePreference } from "../locales";

test("one registry generates native IDs, endonyms, direction, and the device option", () => {
  const files = languageFiles({
    strings: {},
    locales: [
      { tag: "en", nativeName: "English", appStore: ["en-US"], play: ["en-US"] },
      { tag: "ar", nativeName: "العربية", direction: "rtl", appStore: ["ar-SA"], play: ["ar"] },
      { tag: "is", nativeName: "Íslenska", appStore: ["is"], play: ["is"] },
      { tag: "pt-BR", nativeName: "Português (Brasil)", appStore: ["pt-BR"], play: ["pt-BR"] },
    ],
  });
  const kotlin = files.get("android/app/src/main/java/net/a2f0/nc/Language.kt")!;
  const swift = files.get("ios/Shared/AppLanguage.swift")!;
  expect(kotlin).toContain('DEVICE("device", "", false)');
  expect(kotlin).toContain('AR("ar", "العربية", true)');
  expect(kotlin).toContain('PT_BR("pt-BR", "Português (Brasil)", false)');
  expect(swift).toContain('case `device` = "device"');
  expect(swift).toContain('case `is` = "is"'); // A Swift keyword must be escaped.
  expect(swift).toContain('case .`ar`: true');
  expect(swift).toContain('case .`ar`: "العربية"');
  expect(swift).toContain('case `pt_BR` = "pt-BR"');
});

test("only published tags become saved explicit choices", () => {
  expect(languagePreference("de")).toBe("de");
  for (const value of [null, "", "device", "removed", "en-US"]) {
    expect(languagePreference(value)).toBe("device");
  }
});
