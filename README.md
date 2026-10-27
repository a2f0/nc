# Noise Connoisseur

Player for white, pink, and brown noise, a fan, and ocean waves, generated in real time, with
background playback and home screen start/stop widgets. Native on iOS and Android, plus a
desktop web version; no shared code between them, only their strings (see
[localization](docs/localization.md)). This repo is available on the web at
<https://nc.a2f0.net>.

## Quick start

Install [mise](https://mise.jdx.dev/); the native apps also need Xcode or Android Studio.

```sh
mise install            # Java, Gradle, Ruby, Bun, linters and formatters (see .mise.toml)
bundle install          # fastlane, RuboCop
bun install             # agent-tool, TypeScript
bun run hooks:install   # Git hooks
bun run web:dev         # the web app at http://localhost:8080
```

Then build the [iOS](ios/README.md) or [Android](android/README.md) app. The
[development guide](docs/development.md#setup) lists the extra tools that the web integration
tests and screenshots need.

## Platforms

Each platform's README covers building it and what is specific to it.

| | [iOS](ios/README.md) (`ios/`) | [Android](android/README.md) (`android/`) | [Web](web/README.md) (`web/`) |
|---|---|---|---|
| UI | SwiftUI | Jetpack Compose | TypeScript + DOM |
| Audio | `AVAudioEngine` + `AVAudioSourceNode` | `AudioTrack` on a dedicated thread | `AudioWorklet`, played through an `<audio>` element |
| Background | `audio` background mode; stops when the app is quit | `mediaPlayback` foreground service; stops when the app is swiped away from Recents | Keeps playing in background tabs; stops when the tab closes |
| System controls | Now Playing / remote commands | `MediaSession` + media notification | Media Session (media keys, browser media controls) |
| Widget | WidgetKit + `AudioPlaybackIntent` buttons | Glance app widget | None |
| Minimum OS | iOS 18 | Android 8.0 (API 26) | Desktop browsers with `AudioWorklet` |

All three take their strings from `l10n/`. Store lanes live in `fastlane/`, and other
repository commands in [`scripts/`](scripts/README.md).

## Development and releases

- [Development](docs/development.md): setup, generated assets, Git hooks, validation, and screenshots.
- [Application behavior and architecture](docs/architecture.md): noise generation and volume, appearance, listening history, playback diagnostics, and storage.
- [Localization](docs/localization.md): translations, generated resources, store listings, and device validation.
- [Releasing](docs/releasing.md): web deployment, signed mobile builds, store uploads, and listing updates.
- [Readiness](docs/readiness.md): candidate audits and Android foreground-service evidence.
- [Dependency maintenance](docs/dependency-upgrades.md): upgrade procedures and compatibility boundaries.
