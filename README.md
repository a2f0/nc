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

## Appearance

Open **More → Settings → Appearance** and choose **System**, **Light**, or **Dark**.
System is the default and follows the device's appearance automatically. Explicit choices
take effect immediately and stay saved across app restarts and device reboots, using native
preferences or browser local storage. The web app applies the saved choice before rendering
and keeps open tabs in sync. Clearing app/site data removes the preference; blocked browser
storage shows a warning and keeps the choice only for the current page.
The system-controlled mobile launch screen can briefly use the system appearance before
the app's saved appearance takes over.

## Listening history

Open **More → Listening history** and choose **All time** for a bar per sound showing its
total minutes across all saved sessions, or **Calendar** for daily stacked bars and weekly
navigation. Select a sound in either chart's key to open its daily history, with weekly
navigation. **Back to all sounds** restores the overview's view and week. Both charts use
grayscale and minutes played on the Y axis. Calendar uses dates
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

## Playback log

Open **More → Playback log** to view the latest 300 playback events and share them as
text (or save a text file on the web). Each event includes a UTC timestamp, sound, and
reason. Labels follow the app language; diagnostic codes and OS error messages retain
their original form. Details are limited to 512 characters per event. The log stays on
the device and is never automatically uploaded. Native log files are excluded from backups.
Storage failures show a warning and do not prevent playback; a few queued events can be
lost if the process is killed before they reach disk.

Android records UI, widget, notification and media commands, focus changes, output
disconnections, task removal, engine failures, and service destruction. On Android 11+
it matches unfinished playback to the system's retained process-exit records, including
package updates, low memory, crashes and ANRs. Older Android, iOS and the web cannot always
recover a cause: an unfinished playback marker is reported with an unknown cause, at the
time it was detected. Web recovery uses Web Locks to avoid confusing a live tab with a
closed one; without that API, only the original events are shown. iOS also records audio
interruptions, route and engine configuration changes, and delivered termination notices;
web logs context state, worklet/media failures, visibility and page exits.

Android logs live to `adb logcat -s NoisePlayback`; iOS uses the `NoisePlayback` Logger
category; the browser console uses the same tag. The persisted native files are
`no_backup/playback-log-v1.json` (Android) and `Application Support/playback-log-v1.json`
(iOS); web uses the `playback-log` IndexedDB database. Clear app/site data to remove them.
Google Play auto-updates can interrupt ongoing playback. This diagnostic feature does
not restart playback after an update; reopen the app and press Play.

## Setup

```sh
mise install                        # Java, Gradle, Ruby, Bun, ShellCheck, jq (see .mise.toml)
bundle install                      # fastlane, RuboCop
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
See [localization maintenance and rollout](docs/localization.md) for validation and
the remaining work before adding a broad set of languages.

To try one, use Settings → Language. To test the device default, choose Device language,
then on iOS set the scheme's App Language (Edit Scheme → Run → Options); on Android,
change the system language in device Settings; on the web, change the browser's language
settings. On Android 13+, `adb shell cmd locale set-app-locales net.a2f0.nc --locales <tag>`
tests an explicit per-app choice, not the device default. The privacy policy and support
pages are in English only.

On iOS, an explicit in-app choice overrides the device and iOS Settings language for the
app and widget. OS-owned App Intents and Shortcuts metadata still follows iOS's language.

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
favicon, and the `android listing` lane the Play Store graphics. To look at those, run
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
  ShellCheck; RuboCop; shared agent skills are current; localization is current; fastlane
  helper, web, and localization tests; web typecheck, build, and deploy dry run; Android
  debug build, lint, and unit tests; iOS simulator build and audio rendering checks.

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
(iOS App Group). nc has one release tier, `production`, declared in
`fastlane/lib/native_release_target.rb`. Store credentials come from `.secrets/prod/`.
`.secrets` is a gitignored symlink to `../matrix-secrets/nc`
(`ln -s ../matrix-secrets/nc .secrets`), managed and backed up from
[a2f0/matrix](https://github.com/a2f0/matrix) (`docs/secrets.md`). `prod/` holds the App
Store Connect API key, Google Play service account, fastlane match settings (`shared.env`),
and the Android upload key (`nc-upload.keystore`, with its `ANDROID_KEYSTORE_STORE_PASS` and
`ANDROID_KEYSTORE_KEY_PASS` in `app.env`).

Each routine lane has a package script that sets `NATIVE_RELEASE_TIER=production`, such as
`bun run ios:build-release`; options follow the script name, as in
`bun run ios:profiles force:true`. The other lanes run as
`bundle exec fastlane <platform> <lane> [key:value ...]`.

| Lane | Script | Does | Options |
|---|---|---|---|
| `ios build_release` | `ios:build-release` | Signed App Store IPA with a source/hash receipt, without uploading | `build_number:` |
| `ios upload_release` | `ios:upload-release` | `build_release`, then uploads to TestFlight | `build_number:` |
| `ios profiles` | `ios:profiles` | Creates or renews the match App Store profiles (API key) | `force:true` regenerates them, as after the bundle IDs' capabilities or the distribution certificate change |
| `ios register_identifiers` | | Registers the bundle IDs with App Groups (API key) | |
| `ios create_app` | | One time, interactive: creates the App Store Connect app and App Group (Apple ID and 2FA), then runs `profiles` | |
| `ios listing` | `ios:listing` | Uploads the store listing to the version being prepared: text and categories from `fastlane/metadata/ios/`, screenshots from `.screenshots/ios/` | |
| `ios readiness` | `ios:readiness` | Inspects a candidate and its store state, read-only | See [readiness lanes](docs/readiness.md) |
| `android build_release` | `android:build-release` | Signed release App Bundle with a source/hash receipt, without uploading | `build_number:` |
| `android upload_release` | `android:upload-release` | `build_release`, then uploads to a Google Play track and rolls it out | `build_number:`, `track:` (`internal`), `release_status:` (`completed`) |
| `android promote_release` | `android:promote-release` | Promotes the open testing release, unchanged, to production after Google's review | `version_code:` picks one when the track has several; `rollout:0.1` rolls an update out to a share of users |
| `android listing` | `android:listing` | Uploads the store listing: text from `fastlane/metadata/android/`, screenshots from `.screenshots/android/phone/`, and the Play Store graphics | |
| `android readiness` | `android:readiness` | Inspects a candidate and its store state, read-only | See [readiness lanes](docs/readiness.md) |
| `android foreground_service_video` | | Records the release AAB's user-started background playback and notification stop, including actual device audio | `bundletool:` |
| `android publish_foreground_service_video` | | Publishes a reviewed recording to private R2 storage, served by the website at a stable review URL | `reviewed:true` |

`build_number:` is the iOS build number or the Android version code. Without it, iOS takes
one past the latest TestFlight build, and Android one past the highest version code on any
Play track. `track:beta` is open testing, which Google reviews before testers get each
release; `release_status:draft` uploads a release without rolling it out.

The readiness lanes inspect artifacts and store state without submitting or publishing.
See [readiness lanes](docs/readiness.md) for tools, options, report interpretation, and
device regression checks. The
[foreground-service video workflow](docs/readiness.md#android-foreground-service-video)
keeps binary recordings outside Git and checks that the public video matches the candidate AAB.

The listing text is committed under `fastlane/metadata/` (one file per field, in deliver's and
supply's layouts); edit it there and rerun the lanes. Screenshots and graphics aren't committed,
so take screenshots first. `ios listing` can't upload the text until the version has App Review
contact details, which stay out of the repository: until they're added in App Store Connect, it
uploads only the screenshots and fails. `android listing` attaches the listing to the newest
internal release, as Google Play requires one.

One-time store setup that has no API:

- **Google Play:** create the app in Play Console as **Paid** (a free app can never become
  paid), and upload the first App Bundle and roll it out to internal testing by hand. After
  that, `bun run android:upload-release` uploads and rolls out each build. Before
  `track:beta`, set up open testing in Play Console (its countries and, for a personal account
  created since November 2023, production access), and before `bun run android:promote-release`,
  production's countries.
- **App Store:** after `create_app`, set the price ($0.99), App Review contact details, App
  Privacy, and age rating in App Store Connect. Selling paid apps requires an active Paid Apps
  Agreement.
