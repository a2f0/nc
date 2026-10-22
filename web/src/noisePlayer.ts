import {
  type NoiseCommand,
  type NoiseEvent,
  type NoiseOptions,
  PROCESSOR_FILE,
  PROCESSOR_NAME,
} from "./noiseProtocol";
import { t } from "./l10n";
import { PlaybackLog } from "./playbackLog";
import { ListeningHistory } from "./listeningHistory";
import { NOISE_INFO, NOISE_TYPES, type NoiseType } from "./noiseType";

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
const LAST_PLAYED_KEY = "lastPlayed";

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
  /** The most recently played noise, which the play button and media keys resume. Saved in this browser. */
  lastPlayed: NoiseType = loadLastPlayed();
  /** Set when the browser couldn't start audio; cleared by the next play. */
  failed = false;
  /** The page's own volume, from 0 to 1, on top of the system volume. Saved in this browser. */
  volume = loadVolume();

  private engine: Engine | null = null;
  private activeSound: NoiseType | null = null;
  private commandId = 0;
  private readonly listeners = new Set<() => void>();

  constructor(readonly history = new ListeningHistory(), readonly playbackLog = new PlaybackLog()) {
    this.setActionHandler("play", () => this.play(this.lastPlayed, "media_play"));
    this.setActionHandler("pause", () => this.stop("media_pause"));
    this.setActionHandler("stop", () => this.stop("media_stop"));
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

  /** Stops what's playing, or plays the last noise again. */
  togglePlayback(): void {
    this.toggle(this.nowPlaying ?? this.lastPlayed);
  }

  /**
   * Must run during a user gesture (or, after the first one, a media key): browsers only
   * let audio start then.
   */
  play(type: NoiseType, source = "ui"): void {
    this.playbackLog.record("log_play_requested", type, source);
    if (this.nowPlaying !== type) this.history.transition(null);
    this.nowPlaying = type;
    this.lastPlayed = type;
    save(LAST_PLAYED_KEY, type);
    this.failed = false;

    let engine: Engine;
    try { engine = (this.engine ??= this.createEngine()); }
    catch (error) {
      this.playbackLog.record("log_engine_failed", type, String(error), false);
      this.nowPlaying = this.activeSound = null;
      this.history.transition(null);
      this.failed = true;
      this.publish();
      return;
    }
    const request = this.commandId + 1;
    Promise.all([engine.context.resume(), engine.audio.play(), engine.node]).then(() => {
      if (engine === this.engine && request === this.commandId && this.nowPlaying === type
        && engine.context.state === "running" && !engine.audio.paused) {
        this.started(type);
      }
    }).catch((error: unknown) => {
      // A pause() that lands before play() settles is a stop, not a failure.
      if (request === this.commandId && !(error instanceof DOMException && error.name === "AbortError")) this.fail(engine, error);
    });
    this.send(engine, true);
    this.publish();
  }

  stop(source = "ui", requested = true): void {
    if (requested) this.playbackLog.record("log_stop_requested", this.nowPlaying, source);
    if (this.nowPlaying === null) return;
    this.playbackLog.record("log_stopped", this.nowPlaying, source, false);
    this.activeSound = null;
    this.history.transition(null);
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
    save(VOLUME_KEY, String(this.volume));
    this.publish();
  }

  private createEngine(): Engine {
    // This context feeds a live MediaStream, not the speakers directly. Large
    // "playback" buffers arrive in bursts that can starve the stream's consumer.
    // Keep its producer cadence short, even on devices with large output buffers.
    const context = new AudioContext({ latencyHint: "interactive" });
    const volume = context.createGain();
    volume.gain.value = volumeGain(this.volume);
    const output = context.createMediaStreamDestination();
    volume.connect(output);
    const audio = new Audio();
    audio.srcObject = output.stream;
    audio.addEventListener("pause", () => {
      if (engine === this.engine && audio.paused && this.nowPlaying !== null) this.stop("media_element_pause", false);
    });
    audio.addEventListener("error", () => {
      if (engine !== this.engine) return;
      const detail = `code=${audio.error?.code}; ${audio.error?.message ?? ""}`;
      this.playbackLog.record("log_media_error", this.nowPlaying, detail);
      this.fail(engine, detail);
    });
    context.addEventListener("statechange", () => {
      if (engine !== this.engine) return;
      this.playbackLog.record("log_context_state", this.nowPlaying, context.state, context.state === "running" ? undefined : false);
      if (context.state !== "running") {
        this.activeSound = null;
        this.history.transition(null);
      }
      else if (!audio.paused && this.nowPlaying !== null) {
        void node.then(() => {
          if (engine === this.engine && context.state === "running" && !audio.paused) {
            if (this.nowPlaying !== null) this.started(this.nowPlaying);
          }
        }, () => {});
      }
    });

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
        node.addEventListener("processorerror", () => {
          if (engine !== this.engine) return;
          this.playbackLog.record("log_worklet_error", this.nowPlaying, "processorerror");
          this.fail(engine, "processorerror");
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
    this.playbackLog.record("log_engine_failed", this.nowPlaying, String(error), false);
    this.activeSound = null;
    this.history.transition(null);
    this.engine = null;
    engine.audio.pause();
    void engine.context.close();
    this.nowPlaying = null;
    this.failed = true;
    this.publish();
  }

  private started(type: NoiseType): void {
    this.history.transition(type);
    if (this.activeSound === type) return;
    this.activeSound = type;
    this.playbackLog.record("log_started", type, "", true);
  }

  private publish(): void {
    this.updateMediaSession();
    for (const listener of this.listeners) listener();
  }

  /**
   * Shows what's playing in the system's media controls, in the current language. Once
   * something has played, the paused controls keep showing it.
   */
  updateMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = this.nowPlaying === null ? "paused" : "playing";
    if (this.nowPlaying !== null || navigator.mediaSession.metadata !== null) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t(NOISE_INFO[this.nowPlaying ?? this.lastPlayed].title),
        artist: t("app_name"),
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
  const saved = load(VOLUME_KEY);
  return saved === null ? 1 : clampVolume(Number(saved));
}

function loadLastPlayed(): NoiseType {
  const saved = load(LAST_PLAYED_KEY);
  return NOISE_TYPES.find((type) => type === saved) ?? "white";
}

// Storage can be unavailable (private windows, blocked site data); settings then last
// until the page closes.

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not saved.
  }
}
