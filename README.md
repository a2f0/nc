# Noise Connoisseur

Player for white, pink, and brown noise, a fan, and ocean waves, with background playback
and home screen start/stop widgets. Native on iOS and Android, plus a desktop web version;
no shared code between them, only their strings (see [localization](docs/localization.md)).

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

## Setup

```sh
mise install                        # Java, Gradle, Ruby, Bun, ShellCheck, jq (see .mise.toml)
bundle install                      # fastlane, RuboCop
bun install                         # agent-tool, TypeScript
brew install imagemagick            # screenshots only
curl -fsSL https://get.maestro.mobile.dev | bash   # screenshots only
sh scripts/git/install-hooks.sh
sh scripts/dev/ensureGradleWrapper.sh   # the wrapper jar is binary, so it isn't committed
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

## Development and releases

- [Development](docs/development.md): generated assets, Git hooks, validation, and screenshots.
- [Application behavior and architecture](docs/architecture.md): appearance, listening history, playback diagnostics, and storage.
- [Localization](docs/localization.md): translations, generated resources, store listings, and device validation.
- [Releasing](docs/releasing.md): web deployment, signed mobile builds, store uploads, and listing updates.
- [Readiness](docs/readiness.md): candidate audits and Android foreground-service evidence.
- [Dependency maintenance](docs/dependency-upgrades.md): upgrade procedures and compatibility boundaries.
- [Agent guidance](AGENTS.md): validation, managed skills, review, and shipping policy.

Use [app-store-readiness](.agents/skills/app-store-readiness/SKILL.md) for an iOS,
Android, and web pre-release assessment. Record candidate findings and prerequisites
in the release PR.
