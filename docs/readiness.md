# Release readiness lanes

Run `bundle exec fastlane ios readiness` or `bundle exec fastlane android readiness` to
inspect an existing signed release artifact and the corresponding store records. These
lanes **do not build, upload, select a build, submit, or publish**. Android creates a temporary
Play edit for its reads and deletes it without committing. Keep concurrent Play edits/listing
uploads out of the same run.

The default artifacts are `ios/build/release/NoiseConnoisseur.ipa` and
`android/app/build/outputs/bundle/release/app-release.aab`. Reports go to gitignored
`.readiness/ios.json` and `.readiness/android.json` with private file permissions. They contain
artifact SHA-256, version/build, SDK information, source provenance when available, and
individual `verified`, `failed`, `unverified`, or `not_applicable` checks. Review contacts,
credentials, and raw API errors are excluded. Don't commit private reports.

```sh
bundle exec fastlane ios readiness artifact:/absolute/path/candidate.ipa wait_timeout:120
bundle exec fastlane android readiness artifact:/absolute/path/candidate.aab bundletool:/absolute/path/bundletool.jar
# Offline artifact inspection; store checks are explicitly unverified:
bundle exec fastlane ios readiness store:false
# Fail closed on any unknown evidence (currently always fails: manual checks remain):
bundle exec fastlane android readiness strict:true
```

Relative artifact/output paths resolve from the repository root. `output:/absolute/path/report.json`
changes the report location. `store:false` skips credentials and store calls. iOS `wait_timeout`
is 0–1800 seconds (default 0), polling only the inspected version/build until processing ends
or the wait limit is reached. It does not substitute an older valid build. iOS `precheck:false`
skips Fastlane's editable-listing metadata/URL checks, recording that omission. Android
`track:internal` is the default; production, beta, and alpha are also supported.

Normal mode exits successfully when a report was generated, **even if its result is
`not_ready` or `incomplete`**. It is a reporting command, not a release approval. `strict:true`
writes the report first, then fails unless the result is `ready_within_tested_scope`.
Manual device/accessibility checks, declarations, and current policy review remain unverified
in these automated reports, so strict mode intentionally cannot certify full readiness alone.

## Tools and build provenance

Use the repository's Ruby/Bundler setup and existing store credentials (README). iOS
inspection needs macOS `codesign` and `security`. Android needs a JDK and Google's
[bundletool](https://github.com/google/bundletool/releases): put its launcher on PATH or pass
`bundletool:/path/to/bundletool-all.jar` / `BUNDLETOOL_JAR`. No tools are downloaded by the lanes.

`ios build_release` builds/signs an IPA without uploading; `ios beta` reuses it before
TestFlight upload. `android build_release` builds/signs the AAB, and `android internal`
reuses it. Both build lanes write `<artifact>.build.json` with the source commit, dirty flag,
build time, and artifact hash. Keep that receipt beside the artifact when copying it.

A receipt with the wrong hash, a dirty source, or a source commit different from the audited
checkout is a failed check. An older artifact without a receipt has unknown provenance;
the lane never assigns it the current commit. Receipts are local build evidence, not signed
supply-chain attestations. Run release builds from a clean checkout and avoid concurrent
source edits during builds. Build numbering still follows the existing release lanes.

## What is and isn't checked

- iOS: packaged app/widget identifiers, version/SDK, signature integrity, distribution
  profiles, app group entitlements and privacy declarations; exact processed build,
  selected build, review-contact presence, notes, expected locales, and completed iPhone/iPad
  screenshot uploads. `precheck` scans the editable listing for common metadata problems.
- Android: bundle manifest and structure, version/SDK/permissions, JAR signature, release
  mapping, native-library inventory; exact version code on the requested track, matching
  Play AAB hash, expected localized listings and phone screenshots.
- Missing tools, authentication/network problems and inaccessible data are unverified,
  not successful checks. Failed requirements make the result `not_ready`; otherwise any
  unknown requirement makes it `incomplete`.
- Reports leave current policy floors, full console declarations, signer identity where
  not established, native library page-size compatibility, screenshot accuracy and real
  assistive-input/device behavior for review. See the
  [app-store-readiness skill](../.agents/skills/app-store-readiness/SKILL.md) for the full audit.

## Device regression checks

Install a build on a dedicated test device; these flows clear app data. The screenshot
scripts document simulator/emulator setup and how to build a debug-key-signed minified
Android APK. Run:

```sh
maestro --device <device-id> test maestro/readiness.yaml
maestro --device <android-device-id> test maestro/history-background.yaml
```

Repeat the first flow at normal and large text sizes. For Android, set
`adb -s <serial> shell settings put system font_scale 2.0` and restore the original value
afterward. For iOS, use `xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large`
and restore its original size afterward. The background flow checks live history across
Home/foreground transitions, including retaining the selected view/week and continuing
playback. It supplements visual recording; assertions alone do not prove absence of flicker.
