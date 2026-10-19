import type { WebKey } from "./l10n";

/** Permanent storage IDs; rename display strings without changing these keys. */
export type NoiseType = "white" | "pink" | "brown" | "waves" | "fan";

export const NOISE_TYPES: readonly NoiseType[] = ["white", "pink", "brown", "waves", "fan"];

/** Each noise's strings (see l10n.ts). */
export const NOISE_INFO: Readonly<Record<NoiseType, { title: WebKey; shortTitle: WebKey; blurb: WebKey }>> = {
  white: { title: "noise_white_title", shortTitle: "noise_white_short", blurb: "noise_white_blurb" },
  pink: { title: "noise_pink_title", shortTitle: "noise_pink_short", blurb: "noise_pink_blurb" },
  brown: { title: "noise_brown_title", shortTitle: "noise_brown_short", blurb: "noise_brown_blurb" },
  waves: { title: "noise_waves_title", shortTitle: "noise_waves_short", blurb: "noise_waves_blurb" },
  fan: { title: "noise_fan_title", shortTitle: "noise_fan_short", blurb: "noise_fan_blurb" },
};
