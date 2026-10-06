import type { WebKey } from "./l10n";

export type NoiseType = "white" | "pink";

export const NOISE_TYPES: readonly NoiseType[] = ["white", "pink"];

/** Each noise's strings (see l10n.ts). */
export const NOISE_INFO: Readonly<Record<NoiseType, { title: WebKey; blurb: WebKey }>> = {
  white: { title: "noise_white_title", blurb: "noise_white_blurb" },
  pink: { title: "noise_pink_title", blurb: "noise_pink_blurb" },
};
