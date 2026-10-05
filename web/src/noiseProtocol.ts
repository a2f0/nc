import type { NoiseType } from "./noiseType";

// How the page talks to the audio worklet (noiseProcessor.ts). Kept apart from the
// worklet so the page bundle doesn't pull in its registerProcessor call.

export const PROCESSOR_NAME = "noise";

/** The worklet bundle, next to the page (see build.ts). */
export const PROCESSOR_FILE = "noiseProcessor.js";

export interface NoiseOptions {
  seeds: [number, number];
}

/** Sent by the page. Each command has a new, increasing id. */
export interface NoiseCommand {
  id: number;
  type: NoiseType;
  playing: boolean;
}

/** Sent by the worklet once a stop command's fade-out has gone silent. */
export interface NoiseEvent {
  silent: number;
}
