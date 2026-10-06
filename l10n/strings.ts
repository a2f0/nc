// Every string the apps show, in English, the source language. Translations are typed
// against these (see locales.ts), and `bun run l10n` writes each platform's native string
// files from both; the web app imports them directly. See "Localization" in README.md.

export type Platform = "android" | "ios" | "web";

export interface SourceString {
  /** English text. `{name}` is a placeholder, filled in with a string at runtime. */
  readonly text: string;
  /** Context for translators: where the string appears, and what each placeholder holds. */
  readonly comment: string;
  /** The platforms that show it; every one if left out. */
  readonly platforms?: readonly Platform[];
  /** False for names, which stay in English in every language. */
  readonly translatable?: false;
}

export const STRINGS = {
  app_name: {
    text: "Noise Connoisseur",
    comment: "The app's name: on its screen and widget, and the artist in the system's media controls.",
    translatable: false,
  },
  widget_description: {
    text: "Start and stop white or pink noise.",
    comment: "Describes the home screen widget in the system's widget gallery.",
    platforms: ["android", "ios"],
  },
  noise_white_title: {
    text: "White Noise",
    comment: "Name of white noise, which has equal energy at every frequency. Also its title in the system's media controls.",
  },
  noise_pink_title: {
    text: "Pink Noise",
    comment: "Name of pink noise, which is softer at high frequencies than white noise. Also its title in the system's media controls.",
  },
  noise_white_short: {
    text: "White",
    comment: "White noise's name on a home screen widget button, where there's little room.",
    platforms: ["android", "ios"],
  },
  noise_pink_short: {
    text: "Pink",
    comment: "Pink noise's name on a home screen widget button, where there's little room.",
    platforms: ["android", "ios"],
  },
  noise_white_blurb: {
    text: "Equal energy at every frequency. Bright and crisp.",
    comment: "Describes white noise, under its name.",
  },
  noise_pink_blurb: {
    text: "Softer highs, deeper lows. Like steady rain.",
    comment: "Describes pink noise, under its name.",
  },
  status_playing: {
    text: "Playing · {noise}",
    comment: "Status line under the app's name while a noise plays. {noise}: the noise's name, such as “Pink Noise”.",
  },
  status_tap_to_start: {
    text: "Tap a sound to start",
    comment: "Status line under the app's name while nothing plays.",
    platforms: ["android", "ios"],
  },
  status_click_to_start: {
    text: "Click a sound to start",
    comment: "Status line under the app's name while nothing plays.",
    platforms: ["web"],
  },
  status_audio_failed: {
    text: "This browser couldn't start audio.",
    comment: "Status line under the app's name when the browser can't play sound.",
    platforms: ["web"],
  },
  play_noise: {
    text: "Play {noise}",
    comment: "Screen reader label for a noise's button while it's stopped. {noise}: the noise's name, such as “Pink Noise”.",
    platforms: ["ios", "web"],
  },
  stop_noise: {
    text: "Stop {noise}",
    comment: "Screen reader label for a noise's button while it plays. {noise}: the noise's name, such as “Pink Noise”.",
    platforms: ["ios", "web"],
  },
  stop: {
    text: "Stop",
    comment: "Button in the playback notification that stops the noise.",
    platforms: ["android"],
  },
  volume: {
    text: "Volume",
    comment: "Screen reader label for the volume slider.",
  },
  notification_channel_name: {
    text: "Playback",
    comment: "Name of the playback notification's category in the system's notification settings.",
    platforms: ["android"],
  },
  intent_noise: {
    text: "Noise",
    comment: "In the Shortcuts app: what White Noise and Pink Noise are, and the Play Noise action's setting for which one to play.",
    platforms: ["ios"],
  },
  intent_play_title: {
    text: "Play Noise",
    comment: "Shortcuts action that starts a noise.",
    platforms: ["ios"],
  },
  intent_play_description: {
    text: "Starts playing white or pink noise.",
    comment: "Describes the Play Noise action in the Shortcuts app.",
    platforms: ["ios"],
  },
  intent_stop_title: {
    text: "Stop Noise",
    comment: "Shortcuts action that stops the noise.",
    platforms: ["ios"],
  },
  intent_stop_description: {
    text: "Stops playback.",
    comment: "Describes the Stop Noise action in the Shortcuts app.",
    platforms: ["ios"],
  },
  support: {
    text: "Support",
    comment: "Footer link to the support page.",
    platforms: ["web"],
  },
  privacy_policy: {
    text: "Privacy policy",
    comment: "Footer link to the privacy policy.",
    platforms: ["web"],
  },
} as const satisfies Readonly<Record<string, SourceString>>;

export type StringKey = keyof typeof STRINGS;

/** Matches a `{placeholder}`, capturing its name. Use with `replace` or `matchAll`. */
export const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;

/** The names of the `{placeholders}` in `Text`. */
export type Placeholders<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

/** The keys of the strings `P` shows. */
export type PlatformKey<P extends Platform> = {
  [K in StringKey]: (typeof STRINGS)[K] extends { readonly platforms: readonly (infer Shown)[] }
    ? P extends Shown
      ? K
      : never
    : K;
}[StringKey];

type TranslatableKey = {
  [K in StringKey]: (typeof STRINGS)[K] extends { readonly translatable: false } ? never : K;
}[StringKey];

type Containing<Name extends string> = Name extends string ? `${string}{${Name}}${string}` : never;
type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void
  ? I
  : never;

/** A translation of `Text`: anything that keeps each of its placeholders. */
type TranslationOf<Text extends string> = [Placeholders<Text>] extends [never]
  ? string
  : UnionToIntersection<Containing<Placeholders<Text>>>;

/**
 * One language's text for every translatable string. Leaving a string out, adding one
 * that isn't here, or dropping a placeholder is a type error; `bun run l10n` also rejects
 * placeholders that aren't in the English.
 */
export type Translation = { readonly [K in TranslatableKey]: TranslationOf<(typeof STRINGS)[K]["text"]> };
