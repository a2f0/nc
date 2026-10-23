# Localization

The apps are in English, German, and Spanish. Settings → Language defaults to **Device
language**, with English fallback for unsupported languages. Users can choose an explicit
language, saved across relaunches and reboots. Android 13+ shares the OS per-app language
setting; older Android and iOS save the choice locally (iOS shares it with its widget).
Web stores the choice in localStorage, synchronizes tabs, and follows browser language
changes only while Device language is selected. If storage is blocked, the choice works
for the open page and a translated warning explains that it could not be saved.
Changing language refreshes playback labels without stopping audio; native settings may
close as the app's UI is recreated. The App Store lists the languages the binary has, and both stores show the listing
in the user's language when there is one.

Every user-facing string is in `l10n/strings.ts`, the source: its English text, a comment
for translators, and the platforms that show it. Translations are `l10n/<tag>.ts` files typed
against it, so a missing or extra string, or a dropped `{placeholder}`, is a type error.
`bun run l10n` checks them and writes the native files, which are committed; don't edit those.

| | Generated | Used as |
|---|---|---|
| Android | `res/values*/strings.xml`, `res/resources.properties` | `R.string.play_noise`. The Android Gradle plugin builds the per-app language list from the `values-*` folders (`generateLocaleConfig`), and App Bundles keep every language so that list works |
| iOS | `Shared/Localizable.xcstrings`, for the app and the widget | Xcode's generated symbols through `localizedText(.volume)` or `LanguageSettings.string(.playNoise(title))`, applying the saved locale. App Intents' metadata needs literal keys, `LocalizedStringResource("intent_noise")`, which `bun run l10n` checks. Xcode doesn't add strings it finds in code to the catalog (`SWIFT_EMIT_LOC_STRINGS = NO`) |
| Web | Nothing: `web/src/l10n.ts` imports `l10n/` | `t("play_noise", { noise })`, with the keys and placeholders type-checked |

Placeholders become `%1$s` (Android) and `%1$@` (iOS), numbered in the order English has them,
so a translation can put them anywhere. Each platform gets only its own strings; names
(`translatable: false`) stay English.

Each locale in `l10n/locales.ts` also names its App Store Connect and Google Play codes
(Spanish has two in each store, for Spain and Latin America), and needs a store listing for
each in `fastlane/metadata/ios/<code>/` and `fastlane/metadata/android/<code>/` with the same
files as `en-US`, within the stores' length limits (the `listing` lanes upload every one).
Screenshots are English for every language. `bun run l10n:check`, run by
pre-push and CI, typechecks the translations and fails if a generated file is out of date or
a listing is missing or too long.

To add a language:

1. Write `l10n/<tag>.ts` (`export default { ... } satisfies Translation`), translating each
   string with the help of its comment.
2. Add its native name as a nontranslatable, web-only `language_name_*` entry in `strings.ts`
   (native picker enums also use this source text, so separate native resources aren't needed).
   List it in `l10n/locales.ts` with its tag (`de`, `pt-BR`, `zh-Hans`), native name,
   reading direction, and store codes. This registry generates the Android and iOS picker
   enums; the web imports it directly. Do not maintain separate platform language lists.
3. Add its listings under `fastlane/metadata/`.
4. Run `bun run l10n`.

`bun run l10n:report` provides a read-only coverage, store-listing, and generated-file
inventory. `l10n:check` also compiles negative type tests so missing interpolation
arguments, unsupported language IDs, and platform-inappropriate keys remain errors.
Validation and rollout guidance follows below.

To try one, use Settings → Language. To test the device default, choose Device language,
then on iOS set the scheme's App Language (Edit Scheme → Run → Options); on Android,
change the system language in device Settings; on the web, change the browser's language
settings. On Android 13+, `adb shell cmd locale set-app-locales net.a2f0.nc --locales <tag>`
tests an explicit per-app choice, not the device default. The privacy policy and support
pages are in English only.

On iOS, an explicit in-app choice overrides the device and iOS Settings language for the
app and widget. OS-owned App Intents and Shortcuts metadata still follows iOS's language.

## Catalog maintenance

`l10n/strings.ts` is the source catalog, and `l10n/locales.ts` is the published language
registry. Native names (English, Deutsch, Español) let someone recover after choosing a
language they cannot read. Tags are persistent IDs; renaming a display name does not
invalidate a preference. Unknown or removed saved IDs fall back to Device language.

The registry generates Android's `Language.kt` and iOS's `AppLanguage.swift` as well as
the existing native string catalogs. Web uses the typed registry directly. Add languages
there, never by editing generated resources or adding a second list in a picker.

## Updating a language

1. Update English text and translator context together.
2. Update every translation and any affected store listings. A change to English wording
   does **not** currently invalidate an otherwise structurally valid translation; review
   the corresponding translated sentence even when CI passes.
3. Run `bun run l10n`, `bun run l10n:check`, and `bun run l10n:report`.
4. Run `bun run test`, native builds, and the language flow below.
5. Have a fluent speaker review terminology, formality, and screen-reader labels.

The TypeScript catalog checks required keys and required placeholder names at compile
time. The generator additionally rejects extra placeholders, invalid format syntax,
missing/extra keys, incomplete store listings, and stale generated files. Native resource
symbols catch missing keys; they do not universally enforce argument types on Android
`getString`. Keep generator validation as well as compiler checks.

## Device and UI validation

On a dedicated English-language iOS simulator or Android emulator:

```sh
maestro --platform ios --device <simulator-id> test maestro/language.yaml
JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true \
  maestro --platform android --device <emulator-id> test maestro/language.yaml
```

The flow starts audio, changes to German, checks that playback continues, restarts the
app, changes to Spanish, and returns to Device language. Use a minified Android release
build, as in `scripts/testing/takeAndroidScreenshots.sh`. Also test reboot persistence and a
non-English device language. Android tests cover the preference/context fallback on
Android 9; Android 13+ uses `LocaleManager` and its OS-managed persistence.

For web, check a browser with Spanish language preferences, an explicit German choice,
full browser restart, a second tab, Device language, and blocked localStorage. Check
history numbers/dates, accessibility labels, and media-session titles after a change.
`web/test/languageView.test.ts` covers selection priority, device changes, storage failures,
cross-tab updates, and clearing/invalidating a preference.

The pre-push/CI iOS harness also compiles the real string catalog into a temporary app
bundle and checks English, German, and Spanish lookups through `LanguageSettings`.
The Android service test changes the saved language on API 28 without a configuration
callback and checks both the active notification and media-session title.
The widget test keeps a real Glance composition running while changing English to German
to Spanish, checking the emitted RemoteViews labels without a playback change.

iOS uses `localizedText(.key)` and `LanguageSettings.string(.key)` for catalog resources.
These retain generated symbol/interpolation types while applying the saved locale
explicitly, including widgets, history, and now-playing metadata. SwiftUI environment
locale alone does not cover strings resolved outside a view. OS-owned shortcut metadata
continues to use the system's localization of App Intents' literal catalog keys.

## Expanding to global markets

The framework is ready to register more languages; this change publishes no additional
translations. Complete source-key coverage is a structural check, not a quality rating.
Use a staged rollout with these review gates for each language:

- Translate the complete app catalog and mapped store listings. Review with a fluent
  speaker, including regional choices such as Portuguese and Chinese scripts.
- Capture small-screen, large-text, light/dark, widget, and history views. Current store
  screenshot automation is English; localized screenshot matrices still need extending.
- For right-to-left languages, set `direction: "rtl"` and check layouts, chart ordering,
  numbers embedded in text, directional icons, sliders, and accessibility traversal.
  Direction metadata alone does not establish RTL readiness.
- Introduce a typed plural-message schema before adding count-dependent sentences.
  One/other is insufficient for many languages. Generate Android plurals, iOS catalog
  variations, and web `Intl.PluralRules` from that schema; avoid concatenating fragments.
- Localize support/privacy pages with appropriate review. They remain English today.
- Add a review ledger or source-fingerprint workflow before scaling beyond what reviewers
  can track in code review. A changed English sentence can leave a valid but stale translation.

More languages multiply release work (including store screenshots, support, and
accessibility QA). The current web bundle includes all translations; measure its size as
the registry grows and add locale bundles when justified. Native resources remain native.
Translation-service export/import can be layered onto this catalog later, with the same
validation before import; translators should not need to edit Kotlin, Swift, or HTML.

References: [Android per-app languages](https://developer.android.com/guide/topics/resources/app-languages),
[SwiftUI locale](https://developer.apple.com/documentation/swiftui/environmentvalues/locale),
and [Unicode CLDR plural rules](https://cldr.unicode.org/index/cldr-spec/plural-rules).
