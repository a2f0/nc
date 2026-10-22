import type { NoisePlayer } from "./noisePlayer";

export function setUpPlaybackLifecycle(player: NoisePlayer): void {
  window.addEventListener("pagehide", (event) => {
    if (player.nowPlaying === null) return;
    // Close the recovery marker with the first pagehide write: a later stop write
    // may not finish before the browser discards this document.
    player.playbackLog.record("log_page_hidden", player.nowPlaying, `persisted=${event.persisted}`, false);
    player.stop("pagehide", false);
  });
  document.addEventListener("visibilitychange", () => {
    if (player.nowPlaying !== null) player.playbackLog.record("log_visibility", player.nowPlaying, document.visibilityState);
    player.history.checkpoint();
    if (document.visibilityState === "visible") void player.history.refresh();
  });
}
