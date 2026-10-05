export type NoiseType = "white" | "pink";

export const NOISE_TYPES: readonly NoiseType[] = ["white", "pink"];

export const NOISE_INFO: Readonly<Record<NoiseType, { title: string; blurb: string }>> = {
  white: { title: "White Noise", blurb: "Equal energy at every frequency. Bright and crisp." },
  pink: { title: "Pink Noise", blurb: "Softer highs, deeper lows. Like steady rain." },
};
