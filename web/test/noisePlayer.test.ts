import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { setPreferredLanguages } from "../src/l10n";
import { ListeningHistory, type ListeningSession } from "../src/listeningHistory";
import { NoisePlayer } from "../src/noisePlayer";
import type { NoiseCommand, NoiseEvent } from "../src/noiseProtocol";

// A stand-in for the browser audio stack, recording what the player asks of it.

class FakeGainParam {
  value = 1;
  readonly targets: [number, number, number][] = [];

  setTargetAtTime(target: number, startTime: number, timeConstant: number) {
    this.targets.push([target, startTime, timeConstant]);
  }
}

class FakeAudioContext extends EventTarget {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = "running";
  currentTime = 12;
  readonly volume = { gain: new FakeGainParam(), connect() {} };
  readonly moduleLoad = Promise.withResolvers<void>();
  readonly audioWorklet = { addModule: () => this.moduleLoad.promise };

  constructor(readonly options: AudioContextOptions) {
    super();
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    return this.volume;
  }

  createMediaStreamDestination() {
    return { stream: {} };
  }

  async resume() {
    this.state = "running";
  }

  async suspend() {
    this.state = "suspended";
  }

  async close() {
    this.state = "closed";
  }
}

class FakeWorkletNode extends EventTarget {
  static instances: FakeWorkletNode[] = [];
  readonly posted: NoiseCommand[] = [];
  readonly port = {
    onmessage: null as ((event: { data: NoiseEvent }) => void) | null,
    postMessage: (command: NoiseCommand) => this.posted.push(command),
  };

  constructor() {
    super();
    FakeWorkletNode.instances.push(this);
  }

  connect() {}

  emit(event: NoiseEvent) {
    this.port.onmessage?.({ data: event });
  }
}

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  static playError: Error | null = null;
  paused = true;
  srcObject: unknown = null;

  constructor() {
    super();
    FakeAudio.instances.push(this);
  }

  async play() {
    if (FakeAudio.playError !== null) throw FakeAudio.playError;
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }
}

class FakeMediaSession {
  playbackState: MediaSessionPlaybackState = "none";
  metadata: { title: string } | null = null;
  readonly handlers = new Map<string, () => void>();

  setActionHandler(action: string, handler: () => void) {
    this.handlers.set(action, handler);
  }
}

let mediaSession: FakeMediaSession;
let storage: Map<string, string> | null;

beforeEach(() => {
  FakeAudioContext.instances = [];
  FakeWorkletNode.instances = [];
  FakeAudio.instances = [];
  FakeAudio.playError = null;
  mediaSession = new FakeMediaSession();
  storage = new Map();
  Object.assign(globalThis, {
    indexedDB: new IDBFactory(),
    localStorage: {
      getItem: (key: string) => {
        if (storage === null) throw new DOMException("blocked", "SecurityError");
        return storage.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (storage === null) throw new DOMException("blocked", "SecurityError");
        storage.set(key, value);
      },
    },
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeWorkletNode,
    Audio: FakeAudio,
    MediaMetadata: class {
      readonly title: string;
      constructor(init: { title: string }) {
        this.title = init.title;
      }
    },
    document: { baseURI: "http://localhost/" },
  });
  Object.defineProperty(globalThis, "navigator", { value: { mediaSession }, configurable: true });
});

function memoryHistory(): ListeningHistory {
  const rows = new Map<string, ListeningSession>();
  return new ListeningHistory({
    async read() { return [...rows.values()]; },
    async write(row) { rows.set(row.id, { ...row }); },
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Starts a player and lets its worklet load. */
async function loaded(): Promise<{ player: NoisePlayer; context: FakeAudioContext; node: FakeWorkletNode; audio: FakeAudio }> {
  const player = new NoisePlayer(memoryHistory());
  player.play("white");
  const context = FakeAudioContext.instances[0]!;
  context.moduleLoad.resolve();
  await settle();
  return { player, context, node: FakeWorkletNode.instances[0]!, audio: FakeAudio.instances[0]! };
}

describe("NoisePlayer", () => {
  test("uses short audio callbacks when feeding the live media stream", () => {
    new NoisePlayer(memoryHistory()).play("white");
    // A playback-sized producer buffer can underrun the live stream consumer.
    expect(FakeAudioContext.instances[0]!.options.latencyHint).toBe("interactive");
  });

  test("sends commands in order once the worklet loads", async () => {
    const player = new NoisePlayer(memoryHistory());
    player.play("white");
    player.play("pink");
    player.stop();
    player.play("white");
    expect(player.nowPlaying).toBe("white");
    expect(FakeAudioContext.instances).toHaveLength(1);

    FakeAudioContext.instances[0]!.moduleLoad.resolve();
    await settle();
    expect(FakeWorkletNode.instances[0]!.posted).toEqual([
      { id: 1, type: "white", playing: true },
      { id: 2, type: "pink", playing: true },
      { id: 3, type: "pink", playing: false },
      { id: 4, type: "white", playing: true },
    ]);
  });

  test("toggling the playing noise stops it", async () => {
    const { player, node } = await loaded();
    player.toggle("white");
    await settle();
    expect(player.nowPlaying).toBeNull();
    expect(node.posted.at(-1)).toEqual({ id: 2, type: "white", playing: false });
  });

  test("releases the audio device once the latest stop goes silent", async () => {
    const { player, context, node, audio } = await loaded();
    player.stop();
    expect(audio.paused).toBe(false);
    node.emit({ silent: 2 });
    expect(audio.paused).toBe(true);
    expect(context.state).toBe("suspended");

    player.play("pink");
    await settle();
    expect(audio.paused).toBe(false);
    expect(context.state).toBe("running");
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  test("ignores silence from a stop that a newer play replaced", async () => {
    const { player, context, node, audio } = await loaded();
    player.stop();
    player.play("pink");
    node.emit({ silent: 2 });
    expect(audio.paused).toBe(false);
    expect(context.state).toBe("running");
  });

  test("reports a worklet that fails to load, then starts over", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const player = new NoisePlayer(memoryHistory());
    let notified = 0;
    player.subscribe(() => notified++);
    player.play("white");
    FakeAudioContext.instances[0]!.moduleLoad.reject(new Error("no worklet"));
    await settle();
    expect(player.nowPlaying).toBeNull();
    expect(player.failed).toBe(true);
    expect(FakeAudioContext.instances[0]!.state).toBe("closed");
    expect(notified).toBe(2);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();

    player.play("white");
    expect(player.failed).toBe(false);
    expect(FakeAudioContext.instances).toHaveLength(2);
  });

  test("a blocked play() is a failure", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    FakeAudio.playError = new DOMException("blocked", "NotAllowedError");
    const player = new NoisePlayer(memoryHistory());
    player.play("white");
    await settle();
    expect(player.failed).toBe(true);
    expect(player.nowPlaying).toBeNull();
    logged.mockRestore();
  });

  test("a pause() that interrupts play() isn't a failure", async () => {
    FakeAudio.playError = new DOMException("interrupted", "AbortError");
    const player = new NoisePlayer(memoryHistory());
    player.play("white");
    await settle();
    expect(player.failed).toBe(false);
    expect(player.nowPlaying).toBe("white");
  });

  test("media keys play the last noise and stop it", async () => {
    const { player } = await loaded();
    player.play("pink");
    expect(mediaSession.playbackState).toBe("playing");
    expect(mediaSession.metadata?.title).toBe("Pink Noise");

    mediaSession.handlers.get("pause")!();
    expect(player.nowPlaying).toBeNull();
    expect(mediaSession.playbackState).toBe("paused");

    mediaSession.handlers.get("play")!();
    expect(player.nowPlaying).toBe("pink");
  });

  test("the media controls follow a language change, playing or stopped", async () => {
    const player = new NoisePlayer(memoryHistory());
    setPreferredLanguages(["de-DE"]);
    try {
      player.updateMediaSession();
      expect(mediaSession.metadata).toBeNull();

      player.play("pink");
      player.updateMediaSession();
      expect(mediaSession.metadata?.title).toBe("Rosa Rauschen");

      player.stop();
      setPreferredLanguages(["es-MX"]);
      player.updateMediaSession();
      expect(mediaSession.metadata?.title).toBe("Ruido rosa");
    } finally {
      setPreferredLanguages([]);
    }
  });

  test("the play button stops the noise, or plays the last one again", async () => {
    const { player } = await loaded();
    player.play("pink");

    player.togglePlayback();
    expect(player.nowPlaying).toBeNull();

    player.togglePlayback();
    expect(player.nowPlaying).toBe("pink");
  });

  test("remembers the last noise played", () => {
    expect(new NoisePlayer(memoryHistory()).lastPlayed).toBe("white");
    new NoisePlayer(memoryHistory()).play("waves");
    expect(storage!.get("lastPlayed")).toBe("waves");
    expect(new NoisePlayer(memoryHistory()).lastPlayed).toBe("waves");
    storage!.set("lastPlayed", "not a noise");
    expect(new NoisePlayer(memoryHistory()).lastPlayed).toBe("white");
  });

  test("starts at the saved volume", () => {
    storage!.set("volume", "0.5");
    const player = new NoisePlayer(memoryHistory());
    expect(player.volume).toBe(0.5);
    player.play("white");
    expect(FakeAudioContext.instances[0]!.volume.gain.value).toBe(0.25);
  });

  test("ramps to a new volume and saves it", async () => {
    const { player, context } = await loaded();
    player.setVolume(0.5);
    expect(context.volume.gain.targets).toEqual([[0.25, 12, 0.015]]);
    expect(storage!.get("volume")).toBe("0.5");
  });

  test("keeps the volume between 0 and 1", () => {
    const player = new NoisePlayer(memoryHistory());
    player.setVolume(2);
    expect(player.volume).toBe(1);
    player.setVolume(-1);
    expect(player.volume).toBe(0);
    storage!.set("volume", "not a number");
    expect(new NoisePlayer(memoryHistory()).volume).toBe(1);
  });

  test("a volume set before playing applies when it starts", () => {
    const player = new NoisePlayer(memoryHistory());
    player.setVolume(0.4);
    player.play("pink");
    expect(FakeAudioContext.instances[0]!.volume.gain.value).toBeCloseTo(0.16);
  });

  test("works without storage", () => {
    storage = null;
    const player = new NoisePlayer(memoryHistory());
    expect(player.volume).toBe(1);
    player.setVolume(0.3);
    expect(player.volume).toBe(0.3);
    player.play("fan");
    expect(player.lastPlayed).toBe("fan");
  });
});


test("history starts only after audio is ready and closes on switches and media pause", async () => {
  const player = new NoisePlayer(memoryHistory());
  player.play("white");
  expect(player.history.snapshot()).toHaveLength(0);
  FakeAudioContext.instances[0]!.moduleLoad.resolve();
  await settle();
  expect(player.history.snapshot()).toHaveLength(1);
  player.play("fan");
  expect(player.history.snapshot()[0]!.endedAt).not.toBeNull();
  await settle();
  expect(player.history.snapshot()).toHaveLength(2);
  mediaSession.handlers.get("pause")!();
  expect(player.history.snapshot().every((row) => row.endedAt !== null)).toBe(true);
});

test("failed starts and canceled pending starts do not create listening sessions", async () => {
  const player = new NoisePlayer(memoryHistory());
  player.play("white");
  player.stop();
  FakeAudioContext.instances[0]!.moduleLoad.resolve();
  await settle();
  expect(player.history.snapshot()).toHaveLength(0);
  const logged = spyOn(console, "error").mockImplementation(() => {});
  FakeAudio.playError = new DOMException("blocked", "NotAllowedError");
  player.play("fan");
  await settle();
  expect(player.history.snapshot()).toHaveLength(0);
  logged.mockRestore();
});

test("unexpected media pause and audio context suspension stop counting time", async () => {
  const { player, context, audio } = await loaded();
  expect(player.history.snapshot()).toHaveLength(1);
  context.state = "suspended";
  context.dispatchEvent(new Event("statechange"));
  expect(player.history.snapshot()[0]!.endedAt).not.toBeNull();
  context.state = "running";
  context.dispatchEvent(new Event("statechange"));
  await settle();
  expect(player.history.snapshot()).toHaveLength(2);
  audio.paused = true;
  audio.dispatchEvent(new Event("pause"));
  expect(player.nowPlaying).toBeNull();
  expect(player.history.snapshot().every((row) => row.endedAt !== null)).toBe(true);
});


test("a delayed pause event cannot stop a newer play", async () => {
  const { player, node, audio } = await loaded();
  player.stop();
  node.emit({ silent: 2 });
  player.play("fan");
  await settle();
  expect(audio.paused).toBe(false);
  audio.dispatchEvent(new Event("pause"));
  expect(player.nowPlaying).toBe("fan");
  expect(player.history.snapshot().at(-1)!.endedAt).toBeNull();
});

test("worklet processor errors stop playback and retain the failure reason", async () => {
  const player = new NoisePlayer(memoryHistory());
  player.play("pink");
  FakeAudioContext.instances[0]!.moduleLoad.resolve();
  await settle();
  FakeWorkletNode.instances[0]!.dispatchEvent(new Event("processorerror"));
  expect(player.nowPlaying).toBeNull();
  expect(player.failed).toBe(true);
  expect(player.playbackLog.entries.some((row) => row.event === "log_worklet_error" && row.soundId === "pink")).toBe(true);
  expect(player.playbackLog.entries.at(-1)?.event).toBe("log_engine_failed");
});

test("context suspension and media commands retain distinct diagnostics", async () => {
  const player = new NoisePlayer(memoryHistory());
  player.play("brown");
  const context = FakeAudioContext.instances[0]!;
  context.moduleLoad.resolve();
  await settle();
  context.state = "suspended";
  context.dispatchEvent(new Event("statechange"));
  expect(player.playbackLog.entries.at(-1)?.detail).toBe("suspended");
  mediaSession.handlers.get("pause")!();
  expect(player.playbackLog.entries.at(-1)?.detail).toBe("media_pause");
  expect(player.playbackLog.entries.at(-1)?.event).toBe("log_stopped");
});


test("diagnostic observer failures cannot prevent play or stop", async () => {
  const player = new NoisePlayer(memoryHistory());
  player.playbackLog.subscribe(() => { throw new Error("broken diagnostics view"); });
  player.play("pink");
  FakeAudioContext.instances[0]!.moduleLoad.resolve();
  await settle();
  expect(player.nowPlaying).toBe("pink");
  player.stop();
  expect(player.nowPlaying).toBeNull();
});
