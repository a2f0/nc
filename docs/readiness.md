# Release readiness lanes

Run `bun run ios:readiness` or `bun run android:readiness` to inspect an existing signed
release artifact and the corresponding store records. These lanes **do not build, upload,
select a build, submit, or publish**. Android creates a temporary
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

`ios build_release` builds/signs an IPA without uploading; `ios upload_release` runs it
before the TestFlight upload. `android build_release` builds/signs the AAB, and
`android upload_release` runs it before the Play upload. Both build lanes write
`<artifact>.build.json` with the source commit, dirty flag, build time, and artifact hash.
Keep that receipt beside the artifact when copying it.

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
- Screenshot presence is checked in `StoreListing::LOCALE` (`en-US`), matching the
  upload lanes; text is checked in every expected locale.
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
maestro --device <device-id> test maestro/appearance.yaml
```

The appearance flow verifies System/Light/Dark selection across process restarts on both
platforms. Also inspect the visible colors while Settings is open, switch the device's
appearance while System is selected, and reboot the dedicated device with an explicit
choice saved. Selection assertions alone do not prove that a presented sheet repainted.

Repeat the first flow at normal and large text sizes. For Android, set
`adb -s <serial> shell settings put system font_scale 2.0` and restore the original value
afterward. For iOS, use `xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large`
and restore its original size afterward. The background flow checks live history across
Home/foreground transitions, including retaining the selected view/week and continuing
playback. It supplements visual recording; assertions alone do not prove absence of flicker.

## Android foreground-service video

Google Play's [foreground-service declaration](https://support.google.com/googleplay/android-developer/answer/13392821?hl=en)
requires a video showing how the user triggers the feature. Our media-playback demonstration
starts White Noise, returns Home, opens the media notification while audio continues, then
uses its Pause control and returns to the stopped app.

The public review page is **https://nc.a2f0.net/review/android-media-playback**.
The stable direct-video link is **https://nc.a2f0.net/review/android-media-playback.mp4**.
Both follow the current recording. The page also links the immutable MP4 and a JSON
manifest identifying its version, source commits, AAB/APK/video hashes and recording date.
Use the immutable MP4 link when a submission must stay pinned to one candidate.

### Record and publish

Use a clean committed checkout, the existing release AAB and its `.build.json` receipt.
Build/upload with the usual Android lane first if the candidate changed. Recording does
not rebuild or upload the AAB. It accepts an older clean build only when its Android
code, brand assets, image-generation configuration, toolchain pins and Gradle bootstrap
script still match this checkout, allowing subsequent web-only releases.

Install `scrcpy` and `ffmpeg` (`brew install scrcpy ffmpeg` on macOS), Maestro, the Android
SDK emulator/platform/command-line tools and a JDK. Install the
`system-images;android-35;google_apis_playstore;arm64-v8a` SDK image (or set
`ANDROID_EVIDENCE_SYSTEM_IMAGE` for the host architecture). Supply Google's bundletool JAR
as for readiness. The standard `$HOME/.android/debug.keystore` must exist; a Gradle debug
build creates it. No release signing credentials are needed for capture.

```sh
bundle exec fastlane android foreground_service_video bundletool:/absolute/path/bundletool-all.jar
# Inspect .store-evidence/android-media-playback/android-media-playback.mp4 with sound.
bundle exec fastlane android publish_foreground_service_video reviewed:true
bundle exec fastlane android readiness bundletool:/absolute/path/bundletool-all.jar
```

The recorder creates/uses only the dedicated `NoiseConnoisseur_Evidence` AVD on port 5586,
refuses an occupied adb serial or already-running AVD, resets the app on that emulator and
stops its emulator afterward. It generates an APK from the release AAB with bundletool,
using the public local debug key for installation. Release code/resources and minification
are retained; the APK's signing identity is intentionally different and recorded in the manifest.

Maestro drives accessible controls. scrcpy captures video and the device's output audio,
without microphone input or a replacement soundtrack. The script checks Android's foreground
media-playback service while backgrounded, its shutdown after Pause, audible background
audio and silence at the end. It preserves the full timeline while encoding a grayscale,
browser-compatible H.264/AAC MP4. These checks supplement watching the result with sound.

All binaries and raw diagnostics stay in gitignored `.store-evidence/`. Publishing checks
the local MP4's hash/size and the exact candidate AAB hash, uploads the immutable video
first, and updates the current manifest last. `artifact:` overrides the AAB on both lanes;
`manifest:` overrides the publication manifest. Never publish an unreviewed recording.

### Storage and freshness

The private Cloudflare R2 bucket `nc-store-evidence` holds
`android-media-playback/<video-sha256>.mp4` and `android-media-playback/current.json`.
One-time provisioning is `bunx wrangler r2 bucket create nc-store-evidence`, using the
same Cloudflare account as the `nc` Worker. `web/wrangler.jsonc` binds the bucket as
`PLAY_EVIDENCE`. Public bucket access is unnecessary: the Worker exposes only the review
page, current manifest and immutable video paths, with byte ranges for seeking.
Normal `bun run web:deploy` publishes the app/Worker without modifying the stored evidence.
Keep old immutable objects while their links are in store submissions.

Android readiness downloads the public manifest and its immutable video, verifies bytes
against the video SHA-256 and checks the AAB SHA-256 against the inspected candidate.
A new AAB without a matching recording fails `evidence.android_video_candidate`.
Downloaded corrupt bytes or invalid manifest fields fail integrity validation.
Missing/unreachable evidence is unverified, never a pass. If the Worker cannot serve the
manifest, readiness reports unavailable evidence rather than diagnosing its contents.
`store:false` skips this network
read too; `evidence:/absolute/path/manifest.json` checks local evidence in either mode.
Local evidence does not prove the public link is accessible. Existing build-provenance
checks still require auditing from the artifact's own clean source commit.

Readiness never records or publishes as a side effect. After each new candidate, rerun
capture, watch the result, publish, and audit. In Play Console, manually select the
media-playback use case, explain the feature and paste the video link into the foreground
service declaration. Review the public link while signed out. The lanes do not fill out
that declaration or establish Google's approval.
