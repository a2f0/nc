import { NoiseGenerator } from "./noiseGenerator";
import { type NoiseCommand, type NoiseEvent, type NoiseOptions, PROCESSOR_NAME } from "./noiseProtocol";
import type { NoiseType } from "./noiseType";

// The AudioWorkletGlobalScope isn't in TypeScript's DOM library.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

const FADE_SECONDS = 0.4;

/**
 * Renders generated stereo noise on the audio thread. Starting fades in and stopping
 * fades out, so neither clicks. Switching noise type while playing is instant.
 */
class NoiseProcessor extends AudioWorkletProcessor {
  // Independent generators per channel give a wide, decorrelated stereo image.
  private readonly left: NoiseGenerator;
  private readonly right: NoiseGenerator;
  private readonly gainStep = 1 / (sampleRate * FADE_SECONDS);
  private gain = 0;
  private type: NoiseType = "white";
  private fadingOut = true;
  private command = 0;
  private reportedSilence = true;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const { seeds } = options.processorOptions as NoiseOptions;
    this.left = new NoiseGenerator(seeds[0]);
    this.right = new NoiseGenerator(seeds[1]);
    this.port.onmessage = (event: MessageEvent<NoiseCommand>) => {
      this.command = event.data.id;
      this.type = event.data.type;
      this.fadingOut = !event.data.playing;
      this.reportedSilence = false;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const [left, right] = outputs[0] ?? [];
    if (left === undefined) return true;

    const type = this.type;
    const target = this.fadingOut ? 0 : 1;
    for (let frame = 0; frame < left.length; frame++) {
      this.gain =
        this.gain < target ? Math.min(this.gain + this.gainStep, target) : Math.max(this.gain - this.gainStep, target);
      left[frame] = this.left.next(type) * this.gain;
      if (right !== undefined) right[frame] = this.right.next(type) * this.gain;
    }

    if (this.fadingOut && this.gain === 0 && !this.reportedSilence) {
      this.reportedSilence = true;
      this.port.postMessage({ silent: this.command } satisfies NoiseEvent);
    }
    return true;
  }
}

registerProcessor(PROCESSOR_NAME, NoiseProcessor);
