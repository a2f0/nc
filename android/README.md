# Noise Connoisseur for Android

The native Android app, written with Jetpack Compose, with a Glance home screen widget. A
`mediaPlayback` foreground service keeps the noise playing in the background, with a media
notification, until the app is swiped away from Recents. It supports Android 8.0 (API 26) and
later.

## Quick start

Install Android Studio or the Android SDK, and run the
[repository quick start](../README.md#quick-start) first: a Gradle task renders the launcher,
notification, and splash images from `assets/brand/` with agent-tool, which needs Bun and the
installed dependencies. From the repository root:

```sh
sh scripts/dev/ensureGradleWrapper.sh   # the wrapper jar is binary, so it isn't committed
cd android && ./gradlew assembleDebug
```

Or, after generating the wrapper jar, open `android/` in Android Studio. The application ID is
in `android/app/build.gradle.kts`.

Formatting, Android Lint, and detekt are in
[native code quality](../docs/development.md#native-code-quality); signed builds and Google
Play uploads are in [releasing](../docs/releasing.md#stores).
