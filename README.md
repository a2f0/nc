# Noise Connoisseur

Player for white, pink, and brown noise, a fan, and ocean waves, with background playback
and home screen start/stop widgets. Native on iOS and Android, plus a desktop web version;
no shared code between them, only their strings (see "Localization").

| | iOS (`ios/`) | Android (`android/`) | Web (`web/`) |
|---|---|---|---|
| UI | SwiftUI | Jetpack Compose | TypeScript + DOM |
| Audio | `AVAudioEngine` + `AVAudioSourceNode` | `AudioTrack` on a dedicated thread | `AudioWorklet`, played through an `<audio>` element |
| Background | `audio` background mode; stops when the app is quit | `mediaPlayback` foreground service; stops when the app is swiped away from Recents | Keeps playing in background tabs; stops when the tab closes |
| System controls | Now Playing / remote commands | `MediaSession` + media notification | Media Session (media keys, browser media controls) |
| Widget | WidgetKit + `AudioPlaybackIntent` buttons | Glance app widget | None |
| Minimum OS | iOS 18 | Android 8.0 (API 26) | Desktop browsers with `AudioWorklet` |

Noise is generated in real time (xorshift PRNG for white; Paul Kellet's filter for pink; a
leaky integrator for brown; filtered pink noise for the fan, throbbing with its blades over a
hum, and for the waves, swelling and breaking at random), level-matched at about -17 dBFS
(waves average about -23, so their crests don't clip), in stereo, with fade in/out. The
generator is written three times, once per platform; the web and Android tests compare
theirs with samples from the iOS one. Each app has its own volume slider on top of the
system volume: saved between launches, squared so halfway is about -12 dB, and ramped over
about 50 ms so dragging doesn't crackle.

## Listening history

Open **More → Listening history** and choose **All time** for a bar per sound showing its
total minutes across all saved sessions, or **Calendar** for daily stacked bars and weekly
navigation. Both charts use grayscale and minutes played on the Y axis. Calendar uses dates
in the device's current time zone on the X axis and splits overnight sessions at local
midnight. Switching views preserves the selected week.

History stays in the app's data container (`Application Support/listening-history-v1` on iOS,
`files/listening-history-v1` on Android), or the browser's IndexedDB `listening-history` database.
Each session has a UUID `id`, an immutable `soundId` (`white`, `pink`, `brown`, `waves`, `fan`),
and UTC epoch-millisecond `startedAt`, nullable `endedAt`, and `updatedAt` timestamps. Display
names can change without changing these sound IDs. Native sessions are atomic JSON files;
web sessions are individual database rows, so different tabs cannot overwrite one another.
No history is uploaded. The format keeps individual sessions for a future sync API.

Playback starts, stops, sound switches, and interruptions delimit sessions. Active sessions
checkpoint every 15 seconds while the process runs. After an unexpected exit, an unfinished
session ends at its last saved checkpoint, so downtime is never added (the unsaved tail can
be lost). Playback still works if storage fails; History shows a warning. Clearing app/site
data removes the history; operating-system backups may include the native files.

## Setup

```sh
mise install                        # Java, Gradle, Ruby, Bun, ShellCheck, jq (see .mise.toml)
bundle install                      # fastlane
bun install                         # agent-tool, TypeScript
brew install imagemagick            # screenshots only
curl -fsSL https://get.maestro.mobile.dev | bash   # screenshots only
git init && sh scripts/git/install-hooks.sh
sh scripts/ensureGradleWrapper.sh   # the wrapper jar is binary, so it isn't committed
```

## Build

**iOS:** open `ios/NoiseConnoisseur.xcodeproj`, select your team under Signing & Capabilities
for both targets, and run. Bundle ID, App Group, and version live in `ios/Config/Base.xcconfig`.
Source folders are synchronized, so new files are picked up automatically; `ios/Shared/`
compiles into both the app and the widget extension. Each target's `PrivacyInfo.xcprivacy`
declares its required-reason API use (`UserDefaults`, including the App Group's); App Store
Connect rejects uploads that use such an API without declaring it, so update both manifests
when adding one.

**Android:** open `android/` in Android Studio, or `cd android && ./gradlew assembleDebug`.
The application ID is in `android/app/build.gradle.kts`.

**Web:** `bun run web:dev` serves the app at http://localhost:8080 (set `PORT` to change it)
and rebuilds when `web/` changes; reload to pick up a rebuild. `bun run web:build` writes a
static site to the gitignored `web/dist/` (`AudioWorklet` needs a secure context, so it must
be served over HTTPS or from localhost, not `file://`). The page and the audio worklet are
separate bundles (`web/build.ts`); the favicon, also the logo beside the title, is the app icon, built from `assets/brand/*.svg`. The store
listings link to `web/privacy.html` and `web/support.html` (served at `/privacy` and
`/support`); keep the privacy policy accurate when an app starts storing or sending anything new.

## Localization

The apps are in English, German, and Spanish. Each shows the user's language when it's one
of those, and English otherwise. On
Android and iOS that's the system language, or the app's own language setting (Android 13+
and iOS); on the web, the browser's languages (`navigator.languages`), switching when they
change. The App Store lists the languages the binary has, and both stores show the listing
in the user's language when there is one.

Every user-facing string is in `l10n/strings.ts`, the source: its English text, a comment
for translators, and the platforms that show it. Translations are `l10n/<tag>.ts` files typed
against it, so a missing or extra string, or a dropped `{placeholder}`, is a type error.
`bun run l10n` checks them and writes the native files, which are committed; don't edit those.

| | Generated | Used as |
|---|---|---|
| Android | `res/values*/strings.xml`, `res/resources.properties` | `R.string.play_noise`. The Android Gradle plugin builds the per-app language list from the `values-*` folders (`generateLocaleConfig`), and App Bundles keep every language so that list works |
| iOS | `Shared/Localizable.xcstrings`, for the app and the widget | Xcode's generated symbols: `Text(.volume)`, `.playNoise(title)`. App Intents' metadata needs literal keys, `LocalizedStringResource("intent_noise")`, which `bun run l10n` checks. Xcode doesn't add strings it finds in code to the catalog (`SWIFT_EMIT_LOC_STRINGS = NO`) |
| Web | Nothing: `web/src/l10n.ts` imports `l10n/` | `t("play_noise", { noise })`, with the keys and placeholders type-checked |

Placeholders become `%1$s` (Android) and `%1$@` (iOS), numbered in the order English has them,
so a translation can put them anywhere. Each platform gets only its own strings; names
(`translatable: false`) stay English.

Each locale in `l10n/locales.ts` also names its App Store Connect and Google Play codes
(Spanish has two in each store, for Spain and Latin America), and needs a store listing for
each in `fastlane/metadata/ios/<code>/` and `fastlane/metadata/android/<code>/` with the same
files as `en-US`, within the stores' length limits (the `listing` lanes upload every one). Screenshots are English for every language. `bun run l10n:check`, run by
pre-push and CI, typechecks the translations and fails if a generated file is out of date or
a listing is missing or too long.

To add a language:

1. Write `l10n/<tag>.ts` (`export default { ... } satisfies Translation`), translating each
   string with the help of its comment.
2. List it in `l10n/locales.ts` with its tag (`de`, `pt-BR`, `zh-Hans`) and store codes.
3. Add its listings under `fastlane/metadata/`.
4. Run `bun run l10n`.

To try one: on iOS, set the scheme's App Language (Edit Scheme → Run → Options); on Android,
`adb shell cmd locale set-app-locales net.a2f0.nc --locales <tag>`; on the web, the browser's
language settings. The privacy policy and support pages are in English only.

## No binary files

Nothing binary is committed; the hooks reject it (`scripts/checks/checkBinaryFiles.sh`).

**Images** are generated from two SVGs in `assets/brand/`, and the outputs are gitignored:

| Source | Becomes |
|---|---|
| `assets/brand/logo.svg` | The mark, an LCD equalizer drawn full-bleed so its columns touch the icon's bottom edge: the iOS app icon and launch screen logo; the Android adaptive icon foreground, themed (monochrome) icon, and notification icon; the favicon; the logo beside each app's title; the Play Store icon and feature graphic |
| `assets/brand/background.svg` | The iOS app icon backdrop and full-bleed launch screen; the Android adaptive icon background and splash color; the favicon, title logo, and Play Store graphics |

The `images` section of `agent-tool.json` declares every output's size, layers, and
destination, and `agent-tool images` renders them
([reference](https://github.com/a2f0/agent-tool/blob/main/docs/images.md)), with no image
tools to install. Builds regenerate them when the sources change (an Xcode build phase and a
Gradle task before `preBuild`), or run `sh scripts/buildImages.sh`; `web/build.ts` writes the
favicon, and `fastlane android listing` the Play Store graphics. To look at those, run
`sh scripts/buildImages.sh store --out .screenshots/android` (`--out` is relative to the
repository root). Android 12+ splash screens only take a solid color, so Android uses the
background's average color there. Android adaptive icons show the inner 72dp of a 108dp layer,
which the mark fills; its bottom row is stretched to the layer's edge so the columns still
reach the bottom under any launcher mask. Single-color renders (themed and notification icons),
the favicon, and the title logo leave out the mark's `unlit` group of dim segments.

**The Gradle wrapper jar** is regenerated by `scripts/ensureGradleWrapper.sh`.

## Git hooks

Installed by `scripts/git/install-hooks.sh` (rerun it after hooks change; pre-push
refuses to run stale).

- **pre-commit:** branch name is `<type>/<name>` (or `main`); no binary files staged.
- **commit-msg:** Conventional Commits, header at most 50 characters, lowercase subject.
- **pre-push:** commits are signed with no `Co-authored-by` trailers; no binary files;
  ShellCheck; shared agent skills are current; localization is current; fastlane helper,
  web, and localization tests; web typecheck, build, and deploy dry run; Android debug
  build, lint, and unit tests; iOS simulator build and audio rendering checks.

CI (`.github/workflows/ci.yml`) runs the same checks; `CI gate` is the single required check.

## Agent workflow

Coding agents follow [AGENTS.md](AGENTS.md) for command capture, managed skills,
and review and shipping policy. See [dependency maintenance](docs/dependency-upgrades.md)
for upgrade procedures and compatibility boundaries.

Use [app-store-readiness](.agents/skills/app-store-readiness/SKILL.md) for an iOS, Android,
and web pre-release assessment. It checks current policy, interface/accessibility behavior,
and submission evidence; record each candidate’s findings and remaining prerequisites in its PR.

## Screenshots

```sh
sh scripts/takeScreenshots.sh [ios|android]
```

Drives the app with the Maestro flows in `maestro/screenshots/` on dedicated simulators and
a headless emulator, with a fixed 9:41 status bar, in light and dark appearance. Android
runs the minified release build, signed with the debug key. Writes store-sized PNGs (no
alpha) to the gitignored `.screenshots/`: iPhone 6.9" (1320x2868), iPad 13" (2064x2752),
and Android phone (1080x1920, within Google Play's 2:1 limit). The `listing` lanes upload them
(see "Releasing").

## Releasing

**Web:** `bun run web:deploy` builds the site and publishes it as the `nc` Worker with
static assets (`web/wrangler.jsonc`); run `bunx wrangler login` once first. The site's
version, in its About sheet, is the root `package.json` version, which shipping bumps with
each change (see "Shipping" in `AGENTS.md`). `bun run
web:preview` serves the same build through Wrangler's local Workers runtime. Terraform in
[a2f0/a2f0.net](https://github.com/a2f0/a2f0.net) attaches `nc.a2f0.net` to the Worker, as
it does for that zone's other hosts, so publish the Worker before applying it.

**Stores:**

IDs: `net.a2f0.nc` (app, both stores), `net.a2f0.nc.widget` (iOS widget), `group.net.a2f0.nc`
(iOS App Group). Store credentials come from `.secrets/prod/`. `.secrets` is a gitignored
symlink to `../matrix-secrets/nc` (`ln -s ../matrix-secrets/nc .secrets`), managed and backed
up from [a2f0/matrix](https://github.com/a2f0/matrix) (`docs/secrets.md`). `prod/` holds the
App Store Connect API key, Google Play service account, fastlane match settings (`shared.env`),
and the Android upload key (`nc-upload.keystore`, password in `app.env`).

| Lane | Does |
|---|---|
| `fastlane ios register_identifiers` | Registers the bundle IDs with App Groups (API key) |
| `fastlane ios profiles` | Creates the match App Store profiles when missing or no longer valid (API key); `force:true` regenerates them, as after the bundle IDs' capabilities or the distribution certificate change |
| `fastlane ios create_app` | One time, interactive (Apple ID + 2FA): App Store Connect app and App Group, then runs `profiles` |
| `fastlane ios build_release` | Signed IPA with source/hash receipt, without uploading |
| `fastlane ios beta` | Signed build to TestFlight |
| `fastlane android build_release` | Signed release App Bundle with source/hash receipt |
| `fastlane android internal` | Signed release App Bundle, rolled out to internal testers (`release_status:draft` uploads it without rolling it out) |
| `fastlane ios listing` | App Store listing for the version being prepared: text and categories from `fastlane/metadata/ios/`, screenshots from `.screenshots/ios/` |
| `fastlane android listing` | Google Play listing: text from `fastlane/metadata/android/`, screenshots from `.screenshots/android/phone/`, and the Play Store graphics |

The `ios readiness` and `android readiness` lanes inspect artifacts and store state without
submitting or publishing. See [readiness lanes](docs/readiness.md) for tools, options,
report interpretation, and device regression checks.

The listing text is committed under `fastlane/metadata/` (one file per field, in deliver's and
supply's layouts); edit it there and rerun the lanes. Screenshots and graphics aren't committed,
so take screenshots first. `ios listing` can't upload the text until the version has App Review
contact details, which stay out of the repository: until they're added in App Store Connect, it
uploads only the screenshots and fails. `android listing` attaches the listing to the newest
internal release, as Google Play requires one.

Run them with `bundle exec`. One-time store setup that has no API:

- **Google Play:** create the app in Play Console as **Paid** (a free app can never become
  paid), and upload the first App Bundle and roll it out to internal testing by hand. After
  that, `fastlane android internal` uploads and rolls out each build.
- **App Store:** after `create_app`, set the price ($0.99), App Review contact details, App
  Privacy, and age rating in App Store Connect. Selling paid apps requires an active Paid Apps
  Agreement.
