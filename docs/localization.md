# Localization maintenance and rollout

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
build, as in `scripts/takeAndroidScreenshots.sh`. Also test reboot persistence and a
non-English device language. Android tests cover the preference/context fallback on
Android 9; Android 13+ uses `LocaleManager` and its OS-managed persistence.

For web, check a browser with Spanish language preferences, an explicit German choice,
full browser restart, a second tab, Device language, and blocked localStorage. Check
history numbers/dates, accessibility labels, and media-session titles after a change.
`web/test/languageView.test.ts` covers selection priority, device changes, storage failures,
cross-tab updates, and clearing/invalidating a preference.

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
