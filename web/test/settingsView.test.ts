import { expect, test } from "bun:test";
import { setUpSettings } from "../src/settingsView";
import { setPreferredLanguages, t } from "../src/l10n";

test("settings tabs support keyboard navigation, translation, and reopening on General", () => {
  let focused: Element | undefined;
  class Element extends EventTarget {
    textContent = ""; tabIndex = 0; hidden = false; scrollTop = 0;
    attributes = new Map<string, string>();
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    focus() { focused = this; }
    click() { this.dispatchEvent(new Event("click")); }
    key(key: string) {
      const event = Object.assign(new Event("keydown", { cancelable: true }), { key });
      this.dispatchEvent(event);
      return event.defaultPrevented;
    }
  }
  const ids = ["settings", "settings-general-tab", "settings-log-tab", "settings-general", "playback-log-content", "open-settings"];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    Object.defineProperty(globalThis, "document", { configurable: true, value: { getElementById: (id: string) => elements.get(id) } });
    const general = elements.get("settings-general-tab")!, log = elements.get("settings-log-tab")!;
    const preferences = elements.get("settings-general")!, diagnostics = elements.get("playback-log-content")!;
    let refreshes = 0;
    const render = setUpSettings(() => refreshes++);
    render();
    expect(general.attributes.get("aria-selected")).toBe("true");
    expect(log.tabIndex).toBe(-1);
    expect(diagnostics.hidden).toBe(true);
    expect(refreshes).toBe(0);
    elements.get("settings")!.scrollTop = 500;
    expect(general.key("ArrowRight")).toBe(true);
    expect(focused).toBe(log);
    expect(log.attributes.get("aria-selected")).toBe("true");
    expect(general.tabIndex).toBe(-1);
    expect(preferences.hidden).toBe(true);
    expect(diagnostics.hidden).toBe(false);
    expect(elements.get("settings")!.scrollTop).toBe(0);
    expect(refreshes).toBe(1);
    setPreferredLanguages(["de"]);
    render();
    expect(log.textContent).toBe(t("playback_log"));
    expect(general.textContent).toBe(t("settings_general"));
    expect(diagnostics.hidden).toBe(false);
    expect(log.key("ArrowRight")).toBe(true); // Wraps back to General.
    expect(focused).toBe(general);
    expect(general.key("ArrowLeft")).toBe(true);
    expect(focused).toBe(log);
    log.key("Home");
    expect(focused).toBe(general);
    general.key("End");
    expect(focused).toBe(log);
    expect(log.key("Tab")).toBe(false);
    general.click();
    expect(preferences.hidden).toBe(false);
    log.click();
    elements.get("open-settings")!.click();
    expect(preferences.hidden).toBe(false);
    expect(diagnostics.hidden).toBe(true);
    expect(general.tabIndex).toBe(0);
    expect(focused).toBe(general);
  } finally {
    setPreferredLanguages(["en"]);
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
