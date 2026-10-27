# Noise Connoisseur for iOS

The native iPhone and iPad app, written in SwiftUI, with a WidgetKit widget extension whose
buttons start and stop the noise. It plays through `AVAudioEngine`, keeps playing in the
background until the app is quit, and supports iOS 18 and later.

## Quick start

Install Xcode, and run the [repository quick start](../README.md#quick-start) first: an Xcode
build phase renders the app icon and launch images from `assets/brand/` with agent-tool, which
needs Bun and the installed dependencies.

Open `ios/NoiseConnoisseur.xcodeproj`, select your team under Signing & Capabilities for both
targets, and run. To build for the simulator without signing, from the repository root:

```sh
xcodebuild -quiet -project ios/NoiseConnoisseur.xcodeproj -scheme NoiseConnoisseur \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## Project

Bundle ID, App Group, and version live in `ios/Config/Base.xcconfig`. Source folders are
synchronized, so new files are picked up automatically; `ios/Shared/` compiles into both the
app and the widget extension.

Each target's `PrivacyInfo.xcprivacy` declares its required-reason API use (`UserDefaults`,
including the App Group's); App Store Connect rejects uploads that use such an API without
declaring it, so update both manifests when adding one.

Formatting, linting, and compiler settings are in
[native code quality](../docs/development.md#native-code-quality); signed builds and
TestFlight uploads are in [releasing](../docs/releasing.md#stores).
