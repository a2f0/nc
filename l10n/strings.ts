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
    text: "Start and stop each sound with one tap.",
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
  noise_brown_title: {
    text: "Brown Noise",
    comment: "Name of brown noise, which is softer still at high frequencies than pink noise: a deep rumble. Also its title in the system's media controls.",
  },
  noise_fan_title: {
    text: "Fan",
    comment: "Name of the sound of an electric fan blowing. Also its title in the system's media controls.",
  },
  noise_waves_title: {
    text: "Ocean Waves",
    comment: "Name of the sound of waves breaking on a beach. Also its title in the system's media controls.",
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
  noise_brown_short: {
    text: "Brown",
    comment: "Brown noise's name on a home screen widget button, where there's little room.",
    platforms: ["android", "ios"],
  },
  noise_fan_short: {
    text: "Fan",
    comment: "The fan sound's name on a home screen widget button, where there's little room.",
    platforms: ["android", "ios"],
  },
  noise_waves_short: {
    text: "Waves",
    comment: "The ocean waves sound's name on a home screen widget button, where there's little room.",
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
  noise_brown_blurb: {
    text: "Mostly lows, muffled highs. A deep, soft rumble.",
    comment: "Describes brown noise, under its name.",
  },
  noise_fan_blurb: {
    text: "A steady stream of air over a low hum.",
    comment: "Describes the fan sound, under its name.",
  },
  noise_waves_blurb: {
    text: "Surf rolling in and washing out, never the same twice.",
    comment: "Describes the ocean waves sound, under its name.",
  },
  status_audio_failed: {
    text: "This browser couldn't start audio.",
    comment: "Shown under the app's name when the browser can't play sound.",
    platforms: ["web"],
  },
  play_noise: {
    text: "Play {noise}",
    comment: "Screen reader label for a noise's button while it's stopped. {noise}: the noise's name, such as “Pink Noise”.",
    platforms: ["android", "ios", "web"],
  },
  stop_noise: {
    text: "Stop {noise}",
    comment: "Screen reader label for a noise's button while it plays. {noise}: the noise's name, such as “Pink Noise”.",
    platforms: ["android", "ios", "web"],
  },
  stop: {
    text: "Stop",
    comment: "Button in the playback notification that stops the noise.",
    platforms: ["android"],
  },
  volume: {
    text: "Volume",
    comment: "Label for the volume sliders: read by screen readers, and shown above the slider in Settings.",
  },
  more: {
    text: "More",
    comment: "Screen reader label for the three-dot menu button beside the app's name, which opens Settings and About.",
  },
  settings: {
    text: "Settings",
    comment: "Item in the three-dot menu, and the title of the sheet it opens.",
  },
  rate_app: {
    text: "Rate App",
    comment: "Item in the three-dot menu that opens the app's page in the App Store or Google Play, to rate it.",
    platforms: ["android", "ios"],
  },
  about: {
    text: "About",
    comment: "Item in the three-dot menu, and the title of the sheet it opens, which shows the app's name and version.",
  },
  about_version: {
    text: "Version {version} ({build})",
    comment: "In the About sheet, under the app's name. {version}: the app's version, such as “1.0”. {build}: its build number, such as “6”.",
    platforms: ["android", "ios"],
  },
  about_build: {
    text: "Build {build}",
    comment: "In the About sheet, under the app's name. {build}: an identifier for this version of the website, such as “376bb6d”.",
    platforms: ["web"],
  },
  about_also_android_web: {
    text: "Also on {android} and {web}",
    comment: "In the About sheet, under the app's name and version. {android}: a link to the app in Google Play, “Android”. {web}: a link to the website, “the web” (translated separately).",
    platforms: ["ios"],
  },
  about_also_ios_web: {
    text: "Also on {ios} and {web}",
    comment: "In the About sheet, under the app's name and version. {ios}: a link to the app in the App Store, “iOS”. {web}: a link to the website, “the web” (translated separately).",
    platforms: ["android"],
  },
  about_also_ios_android: {
    text: "Also on {ios} and {android}",
    comment: "In the About sheet, under the website's name and build. {ios}: a link to the app in the App Store, “iOS”. {android}: a link to the app in Google Play, “Android”.",
    platforms: ["web"],
  },
  platform_android: {
    text: "Android",
    comment: "Link to the app in Google Play, in the About sheet's “Also on …” line.",
    platforms: ["ios", "web"],
    translatable: false,
  },
  platform_ios: {
    text: "iOS",
    comment: "Link to the app in the App Store, in the About sheet's “Also on …” line.",
    platforms: ["android", "web"],
    translatable: false,
  },
  platform_web: {
    text: "the web",
    comment: "Link to the website, which fills {web} in the About sheet's “Also on {android} and {web}” or “Also on {ios} and {web}”.",
    platforms: ["android", "ios"],
  },
  close: {
    text: "Close",
    comment: "Screen reader label for the button that closes the Settings or About sheet.",
    platforms: ["ios", "web"],
  },
  notification_channel_name: {
    text: "Playback",
    comment: "Name of the playback notification's category in the system's notification settings.",
    platforms: ["android"],
  },
  intent_noise: {
    text: "Noise",
    comment: "In the Shortcuts app: what the app's sounds (White Noise, Fan, Ocean Waves, and so on) are, and the Play Noise action's setting for which one to play.",
    platforms: ["ios"],
  },
  intent_play_title: {
    text: "Play Noise",
    comment: "Shortcuts action that starts a noise.",
    platforms: ["ios"],
  },
  intent_play_description: {
    text: "Starts playing one of the sounds.",
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
