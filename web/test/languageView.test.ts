import { expect, test } from "bun:test";
import { setUpLanguage } from "../src/languageView";
import { currentLocale, setPreferredLanguages, t } from "../src/l10n";

class Element extends EventTarget {
  textContent = "";
  value = "";
  lang = "";
  dir = "";
  checked = false;
  children: Element[] = [];
  append(...children: Element[]) { this.children.push(...children); }
}
class Picker extends Element {
  get selected() { return this.children.map(row => row.children[0]!).find(input => input.checked)?.value; }
  get labels() { return this.children.map(row => row.children[1]!.textContent); }
  choose(value: string) {
    const input = this.children.map(row => row.children[0]!).find(input => input.value === value)!;
    input.checked = true;
    input.dispatchEvent(new Event("change"));
  }
}

function withPage(run: (page: {
  select: Picker; warning: Element; root: { lang: string; dir: string };
  stored: Map<string, string>; browserLanguage: (language: string) => void;
  external: (language: string | null) => void; blockWrites: () => void;
}) => void) {
  const select = new Picker(), warning = new Element();
  const elements = new Map([["language", select], ["language-label", new Element()], ["language-storage-failed", warning]]);
  const root = { lang: "", dir: "" };
  const navigator = { languages: ["es-MX"] };
  const window = new EventTarget();
  const stored = new Map<string, string>();
  let blocked = false;
  const localStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (blocked) throw new Error("Blocked");
      stored.set(key, value);
    },
  };
  const replacements = {
    window, navigator, localStorage,
    document: { documentElement: root, getElementById: (id: string) => elements.get(id),
      createElement: () => new Element() },
  };
  const previous = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, value });
    const render = setUpLanguage(() => render());
    render();
    run({
      select, warning, root, stored,
      browserLanguage: language => { navigator.languages = [language]; window.dispatchEvent(new Event("languagechange")); },
      external: language => {
        if (language === null) stored.clear(); else stored.set("language", language);
        window.dispatchEvent(Object.assign(new Event("storage"), {
          key: language === null ? null : "language", storageArea: localStorage,
        }));
      },
      blockWrites: () => { blocked = true; },
    });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
    setPreferredLanguages([]);
  }
}

test("device default follows browser changes; explicit language persists and takes priority", () => {
  withPage(({ select, root, stored, browserLanguage }) => {
    expect(select.selected).toBe("device");
    expect(root).toEqual({ lang: "es", dir: "ltr" });
    expect(select.labels).toEqual(["Idioma del dispositivo", "English", "Deutsch", "Español"]);
    browserLanguage("de");
    expect(root.lang).toBe("de");
    select.choose("en");
    expect(stored.get("language")).toBe("en");
    browserLanguage("es");
    expect(currentLocale().tag).toBe("en");
    select.choose("device");
    expect(root.lang).toBe("es");
    expect(stored.get("language")).toBe("device");
  });
});

test("blocked saving stays in memory; external changes and clearing storage replace it", () => {
  withPage(({ select, warning, root, stored, blockWrites, browserLanguage, external }) => {
    blockWrites();
    select.choose("de");
    expect(stored.size).toBe(0);
    expect(warning.textContent).toBe(t("language_storage_failed"));
    browserLanguage("en");
    expect(root.lang).toBe("de");
    external("es");
    expect(root.lang).toBe("es");
    expect(select.selected).toBe("es");
    expect(warning.textContent).toBe("");
    external(null);
    expect(select.selected).toBe("device");
    expect(root.lang).toBe("en");
    external("removed-language");
    expect(select.selected).toBe("device");
  });
});
