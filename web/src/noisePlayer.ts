import {
  type NoiseCommand,
  type NoiseEvent,
  type NoiseOptions,
  PROCESSOR_FILE,
  PROCESSOR_NAME,
} from "./noiseProtocol";
import { NOISE_INFO, type NoiseType } from "./noiseType";

/**
 * The audio graph: noise worklet → volume → MediaStream → <audio>. Playing through a media
 * element rather than the context's own destination makes the browser treat this as media,
 * so media keys and the browser's media controls work.
 */
interface Engine {
  context: AudioContext;
  volume: GainNode;
  audio: HTMLAudioElement;
  node: Promise<AudioWorkletNode>;
}

const VOLUME_KEY = "volume";

/** Volume changes settle within about 50 ms (three time constants), so dragging doesn't crackle. */
const VOLUME_TIME_CONSTANT = 0.015;

/**
 * Volume runs from 0 to 1. The gain is its square, which tracks perceived loudness better
 * than a straight line: halfway is about -12 dB.
 */
function volumeGain(volume: number): number {
  return volume * volume;
}

function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 1;
}

/** Plays one noise at a time. Starting and stopping fade (see noiseProcessor.ts). */
export class NoisePlayer {
  nowPlaying: NoiseType | null = null;
  lastPlayed: NoiseType = "white";
  /** Set when the browser couldn't start audio; cleared by the next play. */
  failed = false;
  /** The page's own volume, from 0 to 1, on top of the system volume. Saved in this browser. */
  volume = loadVolume();

  private engine: Engine | null = null;
  private commandId = 0;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.setActionHandler("play", () => this.play(this.lastPlayed));
    this.setActionHandler("pause", () => this.stop());
    this.setActionHandler("stop", () => this.stop());
  }

  subscribe(listener: () => void): void {
    this.listeners.add(listener);
  }

  toggle(type: NoiseType): void {
    if (this.nowPlaying === type) {
      this.stop();
    } else {
      this.play(type);
    }
  }

  /**
   * Must run during a user gesture (or, after the first one, a media key): browsers only
   * let audio start then.
   */
  play(type: NoiseType): void {
    this.nowPlaying = type;
    this.lastPlayed = type;
    this.failed = false;

    const engine = (this.engine ??= this.createEngine());
    void engine.context.resume();
    engine.audio.play().catch((error: unknown) => {
      // A pause() that lands before play() settles is a stop, not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) this.fail(engine, error);
    });
    this.send(engine, true);
    this.publish();
  }

  stop(): void {
    if (this.nowPlaying === null) return;
    this.nowPlaying = null;
    if (this.engine !== null) this.send(this.engine, false);
    this.publish();
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    const engine = this.engine;
    if (engine !== null) {
      engine.volume.gain.setTargetAtTime(volumeGain(this.volume), engine.context.currentTime, VOLUME_TIME_CONSTANT);
    }
    try {
      localStorage.setItem(VOLUME_KEY, String(this.volume));
    } catch {
      // Storage can be unavailable (private windows, blocked site data); the volume still applies.
    }
    this.publish();
  }

  private createEngine(): Engine {
    const context = new AudioContext({ latencyHint: "playback" });
    const volume = context.createGain();
    volume.gain.value = volumeGain(this.volume);
    const output = context.createMediaStreamDestination();
    volume.connect(output);
    const audio = new Audio();
    audio.srcObject = output.stream;

    // Starting from a resolved promise turns a missing audioWorklet (old browsers) into a
    // rejection, which fail() reports, rather than an exception in the click handler.
    const node = Promise.resolve()
      .then(() => context.audioWorklet.addModule(new URL(PROCESSOR_FILE, document.baseURI)))
      .then(() => {
        const seeds = crypto.getRandomValues(new Uint32Array(2));
        const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
          numberOfInputs: 0,
          outputChannelCount: [2],
          processorOptions: { seeds: [seeds[0] ?? 1, seeds[1] ?? 2] } satisfies NoiseOptions,
        });
        node.port.onmessage = (event: MessageEvent<NoiseEvent>) => this.onSilent(engine, event.data.silent);
        node.connect(volume);
        return node;
      });
    const engine: Engine = { context, volume, audio, node };
    node.catch((error: unknown) => this.fail(engine, error));
    return engine;
  }

  /** Commands go out in order, once the worklet has loaded. A failed load is handled by fail(). */
  private send(engine: Engine, playing: boolean): void {
    const command: NoiseCommand = { id: ++this.commandId, type: this.lastPlayed, playing };
    engine.node.then(
      (node) => node.port.postMessage(command),
      () => {},
    );
  }

  /** Releases the audio device once a stop has faded out, unless something newer started. */
  private onSilent(engine: Engine, id: number): void {
    if (engine !== this.engine || id !== this.commandId || this.nowPlaying !== null) return;
    engine.audio.pause();
    void engine.context.suspend();
  }

  private fail(engine: Engine, error: unknown): void {
    if (engine !== this.engine) return;
    console.error("Couldn't start audio", error);
    this.engine = null;
    engine.audio.pause();
    void engine.context.close();
    this.nowPlaying = null;
    this.failed = true;
    this.publish();
  }

  private publish(): void {
    this.updateMediaSession();
    for (const listener of this.listeners) listener();
  }

  private updateMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = this.nowPlaying === null ? "paused" : "playing";
    if (this.nowPlaying !== null) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: NOISE_INFO[this.nowPlaying].title,
        artist: "Noise Connoisseur",
      });
    }
  }

  private setActionHandler(action: MediaSessionAction, handler: () => void): void {
    try {
      navigator.mediaSession?.setActionHandler(action, handler);
    } catch {
      // Not every browser supports every action.
    }
  }
}

function loadVolume(): number {
  try {
    const saved = localStorage.getItem(VOLUME_KEY);
    return saved === null ? 1 : clampVolume(Number(saved));
  } catch {
    return 1;
  }
}
