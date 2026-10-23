import { expect, test } from "bun:test";
import { setUpAppearance } from "../src/appearanceView";
import { setPreferredLanguages, t } from "../src/l10n";

class Element extends EventTarget {
  textContent = "";
}
class Input extends Element {
  checked = false;
  choose() {
    this.checked = true;
    this.dispatchEvent(new Event("change"));
  }
}

function withPage(run: (page: {
  input: (choice: string) => Input;
  element: (id: string) => Element;
  dataset: Record<string, string>;
  storage: Map<string, string>;
  failWrites: () => void;
  externalChange: (value: string | null) => void;
}) => void) {
  const elements = new Map<string, Element>([
    ["appearance-title", new Element()],
    ["appearance-storage-failed", new Element()],
  ]);
  for (const choice of ["system", "light", "dark"]) {
    elements.set(`appearance-${choice}`, new Input());
    elements.set(`appearance-label-${choice}`, new Element());
  }
  const dataset: Record<string, string> = {};
  const storage = new Map([["appearance", "dark"]]);
  let failWrites = false;
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("Storage blocked");
      storage.set(key, value);
    },
  };
  const window = new EventTarget();
  const replacements = {
    window,
    document: {
      documentElement: { dataset },
      getElementById: (id: string) => elements.get(id) ?? null,
      querySelectorAll: () => [],
    },
    HTMLInputElement: Input,
    localStorage,
  };
  const previous = new Map(Object.keys(replacements).map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(replacements)) {
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
    setPreferredLanguages(["en"]);
    run({
      input: (choice) => elements.get(`appearance-${choice}`) as Input,
      element: (id) => elements.get(id)!,
      dataset,
      storage,
      failWrites: () => { failWrites = true; },
      externalChange: (value) => {
        if (value === null) storage.clear();
        else storage.set("appearance", value);
        window.dispatchEvent(Object.assign(new Event("storage"), {
          key: value === null ? null : "appearance", storageArea: localStorage,
        }));
      },
    });
  } finally {
    setPreferredLanguages(["en"]);
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("appearance controls restore, save, and preserve selection when translated", () => {
  withPage(({ input, element, dataset, storage }) => {
    const render = setUpAppearance();
    render();
    expect(input("dark").checked).toBe(true);
    expect(dataset.appearance).toBe("dark");
    input("light").choose();
    expect(storage.get("appearance")).toBe("light");
    expect(dataset.appearance).toBe("light");
    expect(input("dark").checked).toBe(false);
    setPreferredLanguages(["de"]);
    render();
    expect(element("appearance-label-light").textContent).toBe(t("appearance_light"));
    expect(input("light").checked).toBe(true);
    expect(element("appearance-storage-failed").textContent).toBe("");
  });
});

test("blocked saving keeps the choice in memory until an external preference replaces it", () => {
  withPage(({ input, element, dataset, storage, failWrites, externalChange }) => {
    const render = setUpAppearance();
    render();
    failWrites();
    input("light").choose();
    expect(dataset.appearance).toBe("light");
    expect(storage.get("appearance")).toBe("dark");
    expect(element("appearance-storage-failed").textContent).toBe(t("appearance_storage_failed"));
    setPreferredLanguages(["es"]);
    render();
    expect(input("light").checked).toBe(true);
    expect(element("appearance-storage-failed").textContent).toBe(t("appearance_storage_failed"));
    externalChange("dark");
    expect(input("dark").checked).toBe(true);
    expect(input("light").checked).toBe(false);
    expect(dataset.appearance).toBe("dark");
    expect(element("appearance-storage-failed").textContent).toBe("");
    externalChange(null);
    expect(input("system").checked).toBe(true);
    expect(dataset.appearance).toBe("system");
  });
});
