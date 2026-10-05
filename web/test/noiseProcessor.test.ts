import { beforeAll, describe, expect, test } from "bun:test";
import type { NoiseCommand, NoiseEvent, NoiseOptions } from "../src/noiseProtocol";

const SAMPLE_RATE = 48_000;
const BLOCK = 128;

interface Processor {
  port: FakePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

class FakePort {
  onmessage: ((event: { data: NoiseCommand }) => void) | null = null;
  readonly posted: NoiseEvent[] = [];

  postMessage(message: NoiseEvent): void {
    this.posted.push(message);
  }

  send(command: NoiseCommand): void {
    this.onmessage?.({ data: command });
  }
}

let Processor: new (options: { processorOptions: NoiseOptions }) => Processor;

// Stand in for the AudioWorkletGlobalScope, then load the worklet.
beforeAll(async () => {
  const scope = globalThis as Record<string, unknown>;
  scope.sampleRate = SAMPLE_RATE;
  scope.AudioWorkletProcessor = class {
    readonly port = new FakePort();
  };
  scope.registerProcessor = (_name: string, processor: typeof Processor) => {
    Processor = processor;
  };
  await import("../src/noiseProcessor");
});

function create(): Processor {
  return new Processor({ processorOptions: { seeds: [1, 2] } });
}

/** Renders the given number of seconds and returns the peak of the last block. */
function render(processor: Processor, seconds: number): number {
  const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  for (let rendered = 0; rendered < seconds * SAMPLE_RATE; rendered += BLOCK) {
    expect(processor.process([], [output])).toBe(true);
  }
  return Math.max(...output.flatMap((channel) => Array.from(channel, Math.abs)));
}

describe("NoiseProcessor", () => {
  test("is silent until told to play", () => {
    const processor = create();
    expect(render(processor, 0.1)).toBe(0);
    expect(processor.port.posted).toEqual([]);
  });

  test("fades in over 0.4 seconds, then plays at full level", () => {
    const processor = create();
    processor.port.send({ id: 1, type: "white", playing: true });
    const early = render(processor, 0.05);
    const full = render(processor, 0.5);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.25 * 0.2);
    expect(full).toBeGreaterThan(0.1);
  });

  test("fades out, then reports silence for that stop once", () => {
    const processor = create();
    processor.port.send({ id: 1, type: "pink", playing: true });
    render(processor, 0.5);
    processor.port.send({ id: 2, type: "pink", playing: false });
    expect(render(processor, 0.1)).toBeGreaterThan(0);
    expect(processor.port.posted).toEqual([]);
    expect(render(processor, 0.4)).toBe(0);
    render(processor, 0.5);
    expect(processor.port.posted).toEqual([{ silent: 2 }]);
  });

  test("playing again during a fade-out cancels it", () => {
    const processor = create();
    processor.port.send({ id: 1, type: "white", playing: true });
    render(processor, 0.5);
    processor.port.send({ id: 2, type: "white", playing: false });
    render(processor, 0.2);
    processor.port.send({ id: 3, type: "pink", playing: true });
    expect(render(processor, 1)).toBeGreaterThan(0);
    expect(processor.port.posted).toEqual([]);
  });
});
