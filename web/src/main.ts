import { currentLocale, setPreferredLanguages, t } from "./l10n";
import { NoisePlayer } from "./noisePlayer";
import { NOISE_INFO, NOISE_TYPES, type NoiseType } from "./noiseType";

const PLAY_ICON = '<svg class="play" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.3A1 1 0 0 0 8 5.14Z"/></svg>';
const STOP_ICON = '<svg class="stop" viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/></svg>';

setPreferredLanguages(navigator.languages);

const player = new NoisePlayer();
const status = element("status");
const sounds = element("sounds");
const volume = element("volume") as HTMLInputElement;
volume.addEventListener("input", () => player.setVolume(volume.valueAsNumber));

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
  element("support").textContent = t("support");
  element("privacy").textContent = t("privacy_policy");
  for (const [type, button] of cards) {
    button.querySelector(".title")!.textContent = t(NOISE_INFO[type].title);
    button.querySelector(".blurb")!.textContent = t(NOISE_INFO[type].blurb);
  }
  render();
}

function render(): void {
  volume.valueAsNumber = player.volume;
  const playing = player.nowPlaying;
  status.textContent =
    playing !== null
      ? t("status_playing", { noise: t(NOISE_INFO[playing].title) })
      : player.failed
        ? t("status_audio_failed")
        : t("status_click_to_start");
  for (const [type, button] of cards) {
    const isPlaying = type === playing;
    button.classList.toggle("playing", isPlaying);
    const noise = t(NOISE_INFO[type].title);
    button.setAttribute("aria-label", isPlaying ? t("stop_noise", { noise }) : t("play_noise", { noise }));
  }
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id}`);
  return found;
}
