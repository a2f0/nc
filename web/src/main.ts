import { setUpPlaybackLog } from "./playbackLogView";
import { setUpHistory } from "./historyView";
import { setUpAppearance } from "./appearanceView";
import { setUpLanguage } from "./languageView";
import { bindVolume, setUpMenu } from "./controls";
import { currentLocale, t, tParts } from "./l10n";
import { NoisePlayer } from "./noisePlayer";
import { NOISE_INFO, NOISE_TYPES, type NoiseType } from "./noiseType";

const PLAY_ICON = '<svg class="play" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.3A1 1 0 0 0 8 5.14Z"/></svg>';
const STOP_ICON = '<svg class="stop" viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/></svg>';

const APP_STORE_URL = "https://apps.apple.com/app/id6819365110";
const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=net.a2f0.nc";

/** The site's version, from the root package.json, set by build.ts. */
declare const APP_VERSION: string;

const player = new NoisePlayer();
const status = element("status");
const sounds = element("sounds");
const playback = element("playback");
playback.innerHTML = `${PLAY_ICON}${STOP_ICON}`;
playback.addEventListener("click", () => player.togglePlayback());
const volume = element("volume") as HTMLInputElement;
bindVolume([volume, element("settings-volume") as HTMLInputElement], player);

const more = element("more");
const closeButtons = [...document.querySelectorAll<HTMLElement>(".close")];
setUpMenu(document, more, element("menu"), [
  [element("open-playback-log"), element("playback-log") as HTMLDialogElement, element("close-playback-log")],
  [element("open-history"), element("history") as HTMLDialogElement, element("close-history")],
  [element("open-settings"), element("settings") as HTMLDialogElement, element("close-settings")],
  [element("open-about"), element("about") as HTMLDialogElement, element("close-about")],
]);

const renderPlaybackLog = setUpPlaybackLog(player.playbackLog);
const renderHistory = setUpHistory(player.history);
const renderAppearance = setUpAppearance();
const renderLanguage = setUpLanguage(() => {
  localize();
  player.updateMediaSession();
});
setInterval(() => player.history.checkpoint(), 15_000);
window.addEventListener("pagehide", (event) => {
  if (player.nowPlaying === null) return;
  player.playbackLog.record("log_page_hidden", player.nowPlaying, `persisted=${event.persisted}`);
  player.stop("pagehide", false);
});
document.addEventListener("visibilitychange", () => {
  if (player.nowPlaying !== null) player.playbackLog.record("log_visibility", player.nowPlaying, document.visibilityState);
  player.history.checkpoint();
  if (document.visibilityState === "visible") void player.history.refresh();
});

const cards = new Map<NoiseType, HTMLButtonElement>(NOISE_TYPES.map((type) => [type, card(type)]));
sounds.append(...cards.values());
player.subscribe(render);
localize();

function card(type: NoiseType): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card";
  button.innerHTML = `
    <span class="text"><span class="title"></span><span class="blurb"></span></span>
    <span class="toggle" aria-hidden="true">${PLAY_ICON}${STOP_ICON}</span>`;
  button.addEventListener("click", () => player.toggle(type));
  return button;
}

/** Puts the page's text in the current language; index.html has the English. */
function localize(): void {
  volume.setAttribute("aria-label", t("volume"));
  more.setAttribute("aria-label", t("more"));
  element("open-history").textContent = t("history");
  element("history-title").textContent = t("history");
  renderHistory();
  renderPlaybackLog();
  renderAppearance();
  renderLanguage();
  element("open-settings").textContent = t("settings");
  element("open-about").textContent = t("about");
  element("settings-title").textContent = t("settings");
  element("about-title").textContent = t("about");
  document.querySelector('label[for="settings-volume"]')!.textContent = t("volume");
  for (const button of closeButtons) button.setAttribute("aria-label", t("close"));
  element("version").textContent = t("about_site_version", { version: APP_VERSION });
  element("also-on").replaceChildren(
    ...tParts("about_also_ios_android", {
      ios: link(t("platform_ios"), APP_STORE_URL),
      android: link(t("platform_android"), GOOGLE_PLAY_URL),
    }),
  );
  element("support").textContent = t("support");
  element("privacy").textContent = t("privacy_policy");
  for (const [type, button] of cards) {
    button.querySelector(".title")!.textContent = t(NOISE_INFO[type].title);
    button.querySelector(".blurb")!.textContent = t(NOISE_INFO[type].blurb);
  }
  render();
}

function render(): void {
  const playing = player.nowPlaying;
  status.textContent = player.failed ? t("status_audio_failed") : "";
  for (const [type, button] of cards) {
    const isPlaying = type === playing;
    button.classList.toggle("playing", isPlaying);
    button.setAttribute("aria-label", buttonLabel(type, isPlaying));
  }
  playback.classList.toggle("playing", playing !== null);
  playback.setAttribute("aria-label", buttonLabel(playing ?? player.lastPlayed, playing !== null));
}

/** Read as a play or stop button's action, as in the apps. */
function buttonLabel(type: NoiseType, isPlaying: boolean): string {
  const noise = t(NOISE_INFO[type].title);
  return isPlaying ? t("stop_noise", { noise }) : t("play_noise", { noise });
}

/** A link that opens in a new tab, so the noise keeps playing in this one. */
function link(text: string, href: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.textContent = text;
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  return anchor;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id}`);
  return found;
}
