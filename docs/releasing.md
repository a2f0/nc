# Releasing

## Web

`bun run web:deploy` builds the site and publishes it as the `nc` Worker with
static assets (`web/wrangler.jsonc`); run `bunx wrangler login` once first. The site's
version, in its About sheet, is the root `package.json` version, which shipping bumps with
each change (see [shipping policy](../AGENTS.md#shipping)). `bun run web:build` and `web:deploy` enable the production click-tracking bootstrap.
`web:preview` serves a tracking-disabled build through Wrangler's local Workers runtime,
and `web:dev` also leaves tracking disabled. Terraform in
[a2f0/a2f0.net](https://github.com/a2f0/a2f0.net) attaches `nc.a2f0.net` to the Worker, as
it does for that zone's other hosts, so publish the Worker before applying it.

## Stores

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
| `ios readiness` | `ios:readiness` | Inspects a candidate and its store state, read-only | See [readiness lanes](readiness.md) |
| `android build_release` | `android:build-release` | Signed release App Bundle with a source/hash receipt, without uploading | `build_number:` |
| `android upload_release` | `android:upload-release` | `build_release`, then uploads to a Google Play track and rolls it out | `build_number:`, `track:` (`internal`), `release_status:` (`completed`) |
| `android promote_release` | `android:promote-release` | Promotes the open testing release, unchanged, to production after Google's review | `version_code:` picks one when the track has several; `rollout:0.1` rolls an update out to a share of users |
| `android listing` | `android:listing` | Uploads the store listing: text from `fastlane/metadata/android/`, screenshots from `.screenshots/android/phone/`, and the Play Store graphics | |
| `android readiness` | `android:readiness` | Inspects a candidate and its store state, read-only | See [readiness lanes](readiness.md) |
| `android foreground_service_video` | | Records the release AAB's user-started background playback and notification stop, including actual device audio | `bundletool:` |
| `android publish_foreground_service_video` | | Publishes a reviewed recording to private R2 storage, served by the website at a stable review URL | `reviewed:true` |

`build_number:` is the iOS build number or the Android version code. Without it, iOS takes
one past the latest TestFlight build, and Android one past the highest version code on any
Play track. `track:beta` is open testing, which Google reviews before testers get each
release; `release_status:draft` uploads a release without rolling it out.

Google Play reviews every change to the app in one submission. Committing a change that is
sent for review cancels any review in progress and resubmits it with the new change, which
restarts the wait. So internal releases and `android listing` aren't sent for review: they
wait in Play Console's **Publishing overview** and go with the next change that is. An
Android release goes:

1. Upload internal releases while iterating (`bun run android:upload-release`).
2. Upload the candidate to open testing (`bun run android:upload-release track:beta`),
   which sends it, with any waiting changes, for review.
3. Leave open testing and production alone until Google approves it: another `track:beta`
   upload or a promotion restarts the review.
4. Promote it (`bun run android:promote-release`), which is reviewed again, then wait for
   that review the same way.

The readiness lanes inspect artifacts and store state without submitting or publishing.
See [readiness lanes](readiness.md) for tools, options, report interpretation, and
device regression checks. The
[foreground-service video workflow](readiness.md#android-foreground-service-video)
keeps binary recordings outside Git and checks that the public video matches the candidate AAB.

The listing text is committed under `fastlane/metadata/` (one file per field, in deliver's and
supply's layouts); edit it there and rerun the lanes. Screenshots and graphics aren't committed,
so take screenshots first ([screenshots](development.md#screenshots)). The `listing` lanes print
the commit the shared capture was taken from, and fail when it is still running, failed, taken
from uncommitted changes, or replaced while they copy it; with no `.screenshots/capture.json`
they upload the screenshots as they are. `ios listing` can't upload the text until the version has App Review
contact details, which stay out of the repository: until they're added in App Store Connect, it
uploads only the screenshots and fails. `android listing` attaches the listing to the newest
internal release, as Google Play requires one.

One-time store setup that has no API:

- **Google Play:** create the app in Play Console as **Paid** (a free app can never become
  paid), and upload the first App Bundle and roll it out to internal testing by hand. After
  that, `bun run android:upload-release` uploads and rolls out each build. Before
  `track:beta`, set up open testing in Play Console (its countries and, for a personal account
  created since November 2023, production access), and before `bun run android:promote-release`,
  production's countries. The privacy policy URL under **App content** is
  `https://nc.a2f0.net/android/privacy`; the App Store's privacy and support URLs come from
  `fastlane/metadata/ios`.
- **App Store:** after `create_app`, set the price ($0.99), App Review contact details, App
  Privacy, and age rating in App Store Connect. Selling paid apps requires an active Paid Apps
  Agreement.
