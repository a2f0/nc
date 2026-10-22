import { t } from "./l10n";
import { NOISE_INFO } from "./noiseType";
import type { PlaybackLog } from "./playbackLog";

export function setUpPlaybackLog(log: PlaybackLog): () => void {
  const content = document.getElementById("playback-log-content")!;
  const description = document.createElement("p");
  const warning = document.createElement("p");
  warning.setAttribute("role", "status");
  const share = document.createElement("button");
  const save = document.createElement("button");
  const entries = document.createElement("pre");
  entries.className = "playback-log-entries";
  share.type = save.type = "button";
  content.append(description, warning, share, save, entries);
  const entriesText = () => [...log.entries].reverse().map((row) =>
    `${new Date(row.timestamp).toISOString()}  ${row.soundId ? t(NOISE_INFO[row.soundId].title) : ""}\n${t(row.event)} [${row.event}]\n${row.detail}`,
  ).join("\n\n");
  const exportText = () => t("playback_log") + "\n\n" + entriesText();
  share.addEventListener("click", () => {
    void navigator.share({ title: t("playback_log"), text: exportText() }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) warning.textContent = t("playback_log_share_failed");
    });
  });
  save.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([exportText()], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "noise-playback-log.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const render = () => {
    document.getElementById("open-playback-log")!.textContent = t("playback_log");
    document.getElementById("playback-log-title")!.textContent = t("playback_log");
    description.textContent = t("playback_log_local");
    warning.textContent = log.storageFailed ? t("playback_log_storage_failed") : "";
    share.textContent = t("playback_log_share");
    share.hidden = typeof navigator.share !== "function";
    save.textContent = t("playback_log_save");
    share.disabled = save.disabled = log.entries.length === 0;
    entries.textContent = log.entries.length ? entriesText() : t("playback_log_empty");
  };
  log.subscribe(render);
  document.getElementById("open-playback-log")!.addEventListener("click", () => { void log.refresh(); });
  return render;
}
