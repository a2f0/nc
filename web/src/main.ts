import { bindVolume, setUpMenu } from "./controls";
import { currentLocale, setPreferredLanguages, t } from "./l10n";
import { NoisePlayer } from "./noisePlayer";
import { NOISE_INFO, NOISE_TYPES, type NoiseType } from "./noiseType";

const PLAY_ICON = '<svg class="play" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.3A1 1 0 0 0 8 5.14Z"/></svg>';
const STOP_ICON = '<svg class="stop" viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/></svg>';

/** The commit the site was built from, set by build.ts. */
declare const BUILD_ID: string;

setPreferredLanguages(navigator.languages);

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
  [element("open-settings"), element("settings") as HTMLDialogElement, element("close-settings")],
  [element("open-about"), element("about") as HTMLDialogElement, element("close-about")],
]);

const cards = new Map<NoiseType, HTMLButtonElement>(NOISE_TYPES.map((type) => [type, card(type)]));
sounds.append(...cards.values());
player.subscribe(render);
localize();

// Follows the browser's language setting when it changes.
addEventListener("languagechange", () => {
  setPreferredLanguages(navigator.languages);
  localize();
  player.updateMediaSession();
});

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
  document.documentElement.lang = currentLocale().tag;
  volume.setAttribute("aria-label", t("volume"));
  more.setAttribute("aria-label", t("more"));
  element("open-settings").textContent = t("settings");
  element("open-about").textContent = t("about");
  element("settings-title").textContent = t("settings");
  element("about-title").textContent = t("about");
  document.querySelector('label[for="settings-volume"]')!.textContent = t("volume");
  for (const button of closeButtons) button.setAttribute("aria-label", t("close"));
  element("build").textContent = t("about_build", { build: BUILD_ID });
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

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id}`);
  return found;
}
