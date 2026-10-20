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
    comment: "White noise's name on a widget button or chart axis, where there's little room.",
  },
  noise_pink_short: {
    text: "Pink",
    comment: "Pink noise's name on a widget button or chart axis, where there's little room.",
  },
  noise_brown_short: {
    text: "Brown",
    comment: "Brown noise's name on a widget button or chart axis, where there's little room.",
  },
  noise_fan_short: {
    text: "Fan",
    comment: "The fan sound's name on a widget button or chart axis, where there's little room.",
  },
  noise_waves_short: {
    text: "Waves",
    comment: "The ocean waves sound's name on a widget button or chart axis, where there's little room.",
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
  history: {
    text: "Listening history",
    comment: "Title of the local listening-history screen and its menu entry.",
  },
  history_all_time: {
    text: "All time",
    comment: "History view selector: total minutes per sound across all saved listening sessions.",
  },
  history_daily: {
    text: "{noise} daily listening history",
    comment: "Heading for the daily bar chart of a single sound. {noise} is the localized sound name.",
  },
  history_back: {
    text: "Back to all sounds",
    comment: "Button returning from a sound's daily history to the previous listening history overview.",
  },
  history_calendar: {
    text: "Calendar",
    comment: "History view selector: daily listening totals with weekly date navigation.",
  },
  history_sound: {
    text: "Sound",
    comment: "Horizontal axis of the all-time listening chart; each bar is one sound.",
  },
  history_all_time_empty: {
    text: "No listening recorded yet.",
    comment: "Empty state when there is no listening time in the all-time history view.",
  },
  history_minutes: {
    text: "Minutes played",
    comment: "Vertical axis of the listening-history bar chart; durations in minutes.",
  },
  history_date: {
    text: "Date",
    comment: "Horizontal axis of the listening-history bar chart; calendar dates in the current time zone.",
  },
  history_previous: {
    text: "Previous week",
    comment: "Button to move the listening-history chart seven days earlier.",
  },
  history_next: {
    text: "Next week",
    comment: "Button to move the listening-history chart seven days later.",
  },
  history_today: {
    text: "Today",
    comment: "Button to return the history chart to the seven days ending today.",
  },
  history_empty: {
    text: "No listening recorded for these dates.",
    comment: "Empty state for the selected date range in listening history.",
  },
  history_local: {
    text: "Saved on this device. Active listening updates every 15 seconds.",
    comment: "Explanation below the local listening-history chart. No data is synced.",
  },
  history_storage_failed: {
    text: "Some listening history could not be loaded or saved.",
    comment: "Visible warning when local history storage fails; playback can continue.",
  },
  history_value: {
    text: "{noise}: {minutes} min",
    comment: "History chart legend and accessibility label. Noise is the localized sound name; minutes is a localized decimal number.",
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
  about_site_version: {
    text: "Version {version}",
    comment: "In the website's About sheet, under its name. {version}: the website's version, such as “1.0.4”.",
    platforms: ["web"],
  },
  about_also_android_web: {
    text: "Also available on {android} and {web}.",
    comment: "In the About sheet, under the app's name and version. {android}: a link to the app in Google Play, “Android”. {web}: a link to the website, “the web” (translated separately).",
    platforms: ["ios"],
  },
  about_also_ios_web: {
    text: "Also available on {ios} and {web}.",
    comment: "In the About sheet, under the app's name and version. {ios}: a link to the app in the App Store, “iOS”. {web}: a link to the website, “the web” (translated separately).",
    platforms: ["android"],
  },
  about_also_ios_android: {
    text: "Also available on {ios} and {android}.",
    comment: "In the About sheet, under the website's name and build. {ios}: a link to the app in the App Store, “iOS”. {android}: a link to the app in Google Play, “Android”.",
    platforms: ["web"],
  },
  platform_android: {
    text: "Android",
    comment: "Link to the app in Google Play, in the About sheet's “Also available on …” line.",
    platforms: ["ios", "web"],
    translatable: false,
  },
  platform_ios: {
    text: "iOS",
    comment: "Link to the app in the App Store, in the About sheet's “Also available on …” line.",
    platforms: ["android", "web"],
    translatable: false,
  },
  platform_web: {
    text: "the web",
    comment: "Link to the website, which fills {web} in the About sheet's “Also available on {android} and {web}.” or “Also available on {ios} and {web}.”",
    platforms: ["android", "ios"],
  },
  close: {
    text: "Close",
    comment: "Label for the button that closes a sheet, such as History, Settings, or About.",
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
    comment: "Link to the support page, in About on mobile and the website footer.",
  },
  privacy_policy: {
    text: "Privacy policy",
    comment: "Link to the privacy policy, in About on mobile and the website footer.",
  },
  review_title: {
    text: "Android background playback",
    comment: "Heading of the public Google Play foreground-service demonstration page.",
    platforms: ["web"],
  },
  review_intro: {
    text: "This recording demonstrates user-started audio continuing while Noise Connoisseur is in the background. Turn on sound to hear playback.",
    comment: "Introduction to the Google Play review video; asks the viewer to enable sound.",
    platforms: ["web"],
  },
  review_start: {
    text: "Tap Play White Noise in the app.",
    comment: "First step shown in the English Android review recording. Keep “Play White Noise” in English, quoted; optionally add its translation in parentheses.",
    platforms: ["web"],
  },
  review_background: {
    text: "Return to the home screen and open notifications. White Noise continues playing, with media controls visible.",
    comment: "Second step shown in the English background-playback review recording. White Noise is the sound playing; the recording's media title remains in English.",
    platforms: ["web"],
  },
  review_stop: {
    text: "Tap Pause in the notification. The audio stops; returning to the app shows playback is stopped.",
    comment: "Final step shown in the English background-playback review recording. Keep “Pause” in English, quoted; optionally add its translation in parentheses.",
    platforms: ["web"],
  },
  review_capture: {
    text: "Recorded on an Android emulator using an APK generated from the release App Bundle and signed for local testing. The recording includes the device audio.",
    comment: "Explains how the public evidence recording was made, including local signing.",
    platforms: ["web"],
  },
  review_build: {
    text: "Version (build)",
    comment: "Label before the Android app version and build number on the review page.",
    platforms: ["web"],
  },
  review_recorded: {
    text: "Recorded",
    comment: "Label before the UTC recording timestamp on the review page.",
    platforms: ["web"],
  },
  review_download: {
    text: "Download video",
    comment: "Link to download the foreground-service demonstration MP4.",
    platforms: ["web"],
  },
  review_details: {
    text: "Recording details",
    comment: "Link to the public JSON recording provenance and checksums.",
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
