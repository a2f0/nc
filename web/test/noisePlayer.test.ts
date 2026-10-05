import { beforeEach, describe, expect, spyOn, test } from "bun:test";
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

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = "running";
  currentTime = 12;
  readonly volume = { gain: new FakeGainParam(), connect() {} };
  readonly moduleLoad = Promise.withResolvers<void>();
  readonly audioWorklet = { addModule: () => this.moduleLoad.promise };

  constructor() {
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

class FakeWorkletNode {
  static instances: FakeWorkletNode[] = [];
  readonly posted: NoiseCommand[] = [];
  readonly port = {
    onmessage: null as ((event: { data: NoiseEvent }) => void) | null,
    postMessage: (command: NoiseCommand) => this.posted.push(command),
  };

  constructor() {
    FakeWorkletNode.instances.push(this);
  }

  connect() {}

  emit(event: NoiseEvent) {
    this.port.onmessage?.({ data: event });
  }
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  static playError: Error | null = null;
  paused = true;
  srcObject: unknown = null;

  constructor() {
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Starts a player and lets its worklet load. */
async function loaded(): Promise<{ player: NoisePlayer; context: FakeAudioContext; node: FakeWorkletNode; audio: FakeAudio }> {
  const player = new NoisePlayer();
  player.play("white");
  const context = FakeAudioContext.instances[0]!;
  context.moduleLoad.resolve();
  await settle();
  return { player, context, node: FakeWorkletNode.instances[0]!, audio: FakeAudio.instances[0]! };
}

describe("NoisePlayer", () => {
  test("sends commands in order once the worklet loads", async () => {
    const player = new NoisePlayer();
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
    const player = new NoisePlayer();
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
    const player = new NoisePlayer();
    player.play("white");
    await settle();
    expect(player.failed).toBe(true);
    expect(player.nowPlaying).toBeNull();
    logged.mockRestore();
  });

  test("a pause() that interrupts play() isn't a failure", async () => {
    FakeAudio.playError = new DOMException("interrupted", "AbortError");
    const player = new NoisePlayer();
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

  test("starts at the saved volume", () => {
    storage!.set("volume", "0.5");
    const player = new NoisePlayer();
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
    const player = new NoisePlayer();
    player.setVolume(2);
    expect(player.volume).toBe(1);
    player.setVolume(-1);
    expect(player.volume).toBe(0);
    storage!.set("volume", "not a number");
    expect(new NoisePlayer().volume).toBe(1);
  });

  test("a volume set before playing applies when it starts", () => {
    const player = new NoisePlayer();
    player.setVolume(0.4);
    player.play("pink");
    expect(FakeAudioContext.instances[0]!.volume.gain.value).toBeCloseTo(0.16);
  });

  test("works without storage", () => {
    storage = null;
    const player = new NoisePlayer();
    expect(player.volume).toBe(1);
    player.setVolume(0.3);
    expect(player.volume).toBe(0.3);
  });
});
