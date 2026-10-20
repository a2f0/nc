import { describe, expect, test } from "bun:test";
import { APPEARANCE_KEY, parseAppearance, readAppearance, saveAppearance } from "../src/appearance";

describe("saved appearance", () => {
  test("new installations and unknown stored values follow the system", () => {
    for (const value of [null, undefined, "", "DARK", "future-mode", 1]) {
      expect(parseAppearance(value)).toBe("system");
    }
    expect(readAppearance(() => ({ getItem: () => "unknown", setItem() {} }))).toBe("system");
  });

  test("stable values survive a new reader, including returning to system", () => {
    const rows = new Map<string, string>();
    const storage = () => ({
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => { rows.set(key, value); },
    });
    expect(readAppearance(storage)).toBe("system");
    for (const value of ["dark", "light", "system"] as const) {
      expect(saveAppearance(value, storage)).toBe(true);
      expect(rows.get(APPEARANCE_KEY)).toBe(value);
      expect(readAppearance(storage)).toBe(value);
    }
  });

  test("blocked storage falls back safely and reports an unsuccessful save", () => {
    const blocked = () => { throw new Error("Storage access denied"); };
    expect(readAppearance(blocked)).toBe("system");
    expect(saveAppearance("dark", blocked)).toBe(false);
    expect(saveAppearance("light", () => ({
      getItem: () => null,
      setItem() { throw new Error("Quota exceeded"); },
    }))).toBe(false);
  });
});
