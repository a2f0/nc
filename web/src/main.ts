import { NoisePlayer } from "./noisePlayer";
import { NOISE_INFO, NOISE_TYPES, type NoiseType } from "./noiseType";

const PLAY_ICON = '<svg class="play" viewBox="0 0 24 24"><path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l10.6-6.86a1 1 0 0 0 0-1.7L9.52 4.3A1 1 0 0 0 8 5.14Z"/></svg>';
const STOP_ICON = '<svg class="stop" viewBox="0 0 24 24"><rect x="5.5" y="5.5" width="13" height="13" rx="2.5"/></svg>';

const player = new NoisePlayer();
const status = element("status");
const sounds = element("sounds");

const cards = new Map<NoiseType, HTMLButtonElement>(NOISE_TYPES.map((type) => [type, card(type)]));
sounds.append(...cards.values());
player.subscribe(render);
render();

function card(type: NoiseType): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card";
  button.innerHTML = `
    <span class="text"><span class="title"></span><span class="blurb"></span></span>
    <span class="toggle" aria-hidden="true">${PLAY_ICON}${STOP_ICON}</span>`;
  button.querySelector(".title")!.textContent = NOISE_INFO[type].title;
  button.querySelector(".blurb")!.textContent = NOISE_INFO[type].blurb;
  button.addEventListener("click", () => player.toggle(type));
  return button;
}

function render(): void {
  const playing = player.nowPlaying;
  status.textContent =
    playing !== null
      ? `Playing · ${NOISE_INFO[playing].title}`
      : player.failed
        ? "This browser couldn't start audio."
        : "Click a sound to start";
  for (const [type, button] of cards) {
    const isPlaying = type === playing;
    button.classList.toggle("playing", isPlaying);
    button.setAttribute("aria-label", `${isPlaying ? "Stop" : "Play"} ${NOISE_INFO[type].title}`);
  }
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id}`);
  return found;
}
