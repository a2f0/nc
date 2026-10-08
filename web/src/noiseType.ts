import type { WebKey } from "./l10n";

export type NoiseType = "white" | "pink" | "brown" | "waves" | "fan";

export const NOISE_TYPES: readonly NoiseType[] = ["white", "pink", "brown", "waves", "fan"];

/** Each noise's strings (see l10n.ts). */
export const NOISE_INFO: Readonly<Record<NoiseType, { title: WebKey; blurb: WebKey }>> = {
  white: { title: "noise_white_title", blurb: "noise_white_blurb" },
  pink: { title: "noise_pink_title", blurb: "noise_pink_blurb" },
  brown: { title: "noise_brown_title", blurb: "noise_brown_blurb" },
  waves: { title: "noise_waves_title", blurb: "noise_waves_blurb" },
  fan: { title: "noise_fan_title", blurb: "noise_fan_blurb" },
};
