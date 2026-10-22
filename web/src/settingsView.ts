import { t } from "./l10n";

/** Settings always opens on General; diagnostics are a secondary, keyboard-accessible tab. */
export function setUpSettings(onShowLog: () => void): () => void {
  const sheet = document.getElementById("settings")!;
  const tabs = ["settings-general-tab", "settings-log-tab"].map(id => document.getElementById(id)!);
  const panels = ["settings-general", "playback-log-content"].map(id => document.getElementById(id)!);
  const select = (index: number) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i]!.hidden = i !== index;
    });
    sheet.scrollTop = 0;
    if (index === 1) onShowLog();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", event => {
      const key = (event as KeyboardEvent).key;
      let next: number;
      if (key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      else if (key === "Home") next = 0;
      else if (key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      select(next);
      tabs[next]!.focus();
    });
  });
  document.getElementById("open-settings")!.addEventListener("click", () => {
    select(0);
    tabs[0]!.focus();
  });
  select(0);
  return () => {
    tabs[0]!.textContent = t("settings_general");
    tabs[1]!.textContent = t("playback_log");
  };
}
