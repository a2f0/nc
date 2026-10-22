import { expect, test } from "bun:test";
import { PlaybackLog } from "../src/playbackLog";
import { setUpPlaybackLog } from "../src/playbackLogView";
import { setPreferredLanguages, t } from "../src/l10n";

class Element extends EventTarget {
  textContent = ""; hidden = false; disabled = false; href = ""; download = "";
  children: Element[] = [];
  setAttribute() {}
  append(...children: Element[]) { this.children.push(...children); }
  click() { if (!this.disabled) this.dispatchEvent(new Event("click")); }
}

test("log view exports text, handles missing sharing, and retains translated warnings", async () => {
  const elements = new Map(["playback-log-content", "open-playback-log", "playback-log-title"].map(id => [id, new Element()]));
  let download: Element | undefined;
  const navigator: { share?: (data: ShareData) => Promise<void> } = {};
  const replacements = { navigator, document: {
    getElementById: (id: string) => elements.get(id),
    createElement(tag: string) { const element = new Element(); if (tag === "a") download = element; return element; },
  } };
  const previous = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, value });
    setPreferredLanguages(["en"]);
    const log = new PlaybackLog({ async read() { return []; }, async markers() { return []; }, async write() {} }, null);
    await log.ready;
    const render = setUpPlaybackLog(log);
    render();
    const [, warning, share, save, entries] = elements.get("playback-log-content")!.children as [Element, Element, Element, Element, Element];
    expect(share.hidden).toBe(true);
    expect(share.disabled).toBe(true);
    expect(save.disabled).toBe(true);
    expect(entries.textContent).toBe(t("playback_log_empty"));
    log.record("log_started", "pink", "<script>untrusted</script>", true);
    expect(save.disabled).toBe(false);
    expect(entries.textContent).toContain("<script>untrusted</script>");
    save.click();
    expect(download?.download).toBe("noise-playback-log.txt");
    const exported = await (await fetch(download!.href)).text();
    expect(exported).toContain("log_started");
    expect(exported).toContain("Pink Noise");
    let shared: ShareData | undefined;
    navigator.share = async data => { shared = data; throw new Error("share failed"); };
    render();
    expect(share.hidden).toBe(false);
    share.click();
    await Promise.resolve();
    expect(shared?.text).toContain("log_started");
    expect(warning.textContent).toBe(t("playback_log_share_failed"));
    log.record("log_visibility", "pink", "visible");
    setPreferredLanguages(["de"]);
    render();
    expect(warning.textContent).toBe(t("playback_log_share_failed"));
    log.storageFailed = true;
    render();
    expect(warning.textContent).toContain(t("playback_log_storage_failed"));
    expect(warning.textContent).toContain(t("playback_log_share_failed"));
    navigator.share = async () => { throw new DOMException("cancelled", "AbortError"); };
    share.click();
    await Promise.resolve();
    expect(warning.textContent).toBe(t("playback_log_storage_failed"));
    await log.flushed();
  } finally {
    setPreferredLanguages(["en"]);
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
