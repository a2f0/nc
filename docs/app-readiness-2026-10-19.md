# App readiness audit — 2026-10-19

This is the first dogfood run of [app-store-readiness](../.agents/skills/app-store-readiness/SKILL.md).
It covers iOS/iPadOS, Android, and the ordinary web app. It prepares improvements for shipping;
it does **not** authorize public store submission or certify accessibility conformance.

## Candidate and result

The candidate is the changes in this report's PR, based on
`f2d28591cf881f5527e22fb7638f9ab6e0e7030b`. Validation below applies to the local candidate,
not to the previously uploaded mobile binaries. The PR records the final reviewed commit
and CI result. Mobile source defaults are version 1.0, build/code 1; release lanes assign
store build numbers separately. The web base version is 1.0.9; shipping prepares the next patch.

| Platform | Result | Reason |
| --- | --- | --- |
| iOS/iPadOS | **Not ready for public submission** | App Store Connect version 1.0 is `PREPARE_FOR_SUBMISSION`, with no selected build and no review-detail record. Simulator checks passed, but the changed candidate needs a signed release artifact and manual device coverage. |
| Android | **Incomplete** | Minified release UI and local checks passed. Production eligibility, declarations, and physical-device/assistive-input coverage remain unverified. |
| Web | **Ready within tested Chrome scope** | Local compact-layout, automated accessibility, keyboard dismissal/focus return, playback, and history checks passed. Other engines and a real screen reader remain unverified. Corrected public pages require deployment. |

Existing beta evidence was read separately: iOS build **11** is `VALID`; Google Play internal
version code **13** is `completed`. These are the preceding release, not this candidate.
Read-only Apple API queries inspected build/version/localization/screenshot/review-detail
records. Play inspection created and deleted a temporary edit to read the internal track;
it did not commit a release. No contact details or credentials are included here.

## Findings repaired in this PR

| Severity | Finding and change | Retest |
| --- | --- | --- |
| Major | Native About screens lacked direct privacy-policy access. Added localized privacy and support links on both platforms, retaining grayscale styling and native touch targets. Apple §5.1.1(i) and Google User Data policy require in-app policy access. | Maestro reaches both links on iPhone/iPad and an Android minified release; shared public URLs return HTTP 200. Opening every external browser/store destination is not covered. |
| Major | At the largest iOS accessibility text size, the About name/version and platform text compressed or truncated. About now stacks its identity vertically at accessibility sizes; shared sheets scroll when their content exceeds the available height. | iPhone simulator at accessibility extra-extra-extra-large and iPad simulator; links and dismissal remain reachable. |
| Minor | Android history's mutually exclusive choices used filter-chip checkbox semantics. Replaced them with a selectable group and radio-button choices, retaining selected grayscale contrast and a 48dp minimum target. | Minified release flow and accessibility-tree inspection of labels, role, and selection. This is not a TalkBack session. |
| Major | Privacy copy made an overly broad no-storage claim despite local history; support copy implied web background/widget capabilities matched native apps. Scoped storage/networking statements and described browser suspension and native-only widgets. | Local pages inspected; production URLs were reachable but still served the preceding release during the audit. Deploy and verify the revised wording before relying on it for review. |

Policy bases: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
and [Google User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311),
accessed October 19, 2026. Severity describes this release assessment, not a prediction of
certain store rejection. The privacy wording change does not claim that local storage is
transmission to the developer.

## Evidence and coverage

Tests used dedicated devices and disposable app/browser data. The iOS build is an unsigned
Debug simulator build from Xcode 26.3 (17C529), on iOS 26.2 iPhone 16 Pro Max and iPad 13-inch
simulators. Android is an R8-minified release APK signed with the local debug key, running
on an API 35 Pixel 2 emulator at font scale 2.0. Neither is a signed store candidate.

Chrome automation used the locally installed Google Chrome and a fresh browser context.
At 320×640 CSS pixels, English/German/Spanish × light/dark × home/About/settings/history
produced **24 screens with zero axe WCAG 2 A/AA, 2.1 AA, or 2.2 AA findings**, no horizontal
page overflow, and no JavaScript page errors. Dialog Escape and focus return were checked.
A separate real-playback run verified stopping, current and historical all-time totals,
five sound bars, calendar navigation, reload persistence, and desktop/narrow light/dark views.
The scan used empty history; the separate playback test exercised populated history.
These browser scripts and detailed runtime captures were disposable diagnostics, not CI tests.
The checked-in repeatable native smoke flow is [maestro/readiness.yaml](../maestro/readiness.yaml).

| Check | iOS/iPadOS | Android | Web |
| --- | --- | --- | --- |
| Candidate builds and relevant local checks | Verified simulator build | Verified release build, debug lint and unit tests | Verified local browser build; full web gate runs before shipping |
| About links, history switching, dismissal | Verified simulator automation | Verified minified-release automation | Verified Chrome automation |
| Large text / compact layout | Verified largest text on iPhone; iPad smoke coverage | Verified 2.0 font-scale smoke coverage; chart limitation below | Verified 320 CSS-pixel reflow; 200% text resizing unverified |
| Accessibility semantics | Source and UI-automation evidence; VoiceOver unverified | Radio role/state inspected; TalkBack unverified | Axe and Escape/focus return verified; full keyboard and screen reader unverified |
| Light/dark and localization | Wider native matrix unverified in this audit | Wider native matrix unverified in this audit | Verified three locales and both appearances |
| Real playback and history persistence | Existing automated model/audio checks; new manual device session unverified | Existing automated model/audio checks; new manual device session unverified | Verified Chrome, including reload |
| Physical audio interruptions/routes/background and widgets | Unverified | Unverified | Native widget N/A; browser suspension behavior not guaranteed |
| Shipping artifact SDK/signature/manifests | Unverified for changed candidate | Local release manifest inspected; production AAB/signature unverified | No store artifact; production deploy verification pending |
| Store submission fields | Failed selected-build/review-detail prerequisites; other fields below unverified | Console declarations/production eligibility unverified | N/A: ordinary website |
| Accounts, UGC, ads, in-app billing, ATT | N/A: no such features found | N/A: no such features found | N/A: no such features found |

The Android merged release manifest has no `INTERNET` permission; it includes the app's
media foreground service and dependency-provided wake/network-state/boot permissions.
Source iOS app/widget privacy manifests declare no tracking or collected data and the
UserDefaults reasons `CA92.1` and `1C8F.1`. Archive inclusion remains unverified. Settings/history
stay local, with OS backups possible; web hosting and external links have separate network
behavior. Public privacy/support URLs returned 200. App Store Connect's English description,
support URL, and three screenshots each for `APP_IPHONE_67` and `APP_IPAD_PRO_3GEN_129` exist;
this does not verify their visual accuracy for the changed candidate or all locale coverage.

Local Android checks emitted existing Robolectric native-access and DataStore/protobuf
`Unsafe` deprecation warnings. These are not runtime test failures; a passing command is
not evidence of warning-free output. Lint reported four existing warnings: an inlined media
foreground-service constant, a newer target API recommendation, and two widget attributes
that only apply on API 31+. None requires changing the current submission floor by inference.

Reproduction entry points (wrap finite noisy commands with the repository
`bun run --silent agent:run --label <name> --` harness):

```sh
python3 /Users/a2f0/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/app-store-readiness
xcodebuild -quiet -project ios/NoiseConnoisseur.xcodeproj -scheme NoiseConnoisseur \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
android/gradlew -p android --quiet assembleRelease lintDebug testDebugUnitTest
maestro --device <dedicated-device-id> test maestro/readiness.yaml
bun run web:dev
```

Install the resulting app before Maestro; use the documented screenshot workflow for a
debug-key-signed minified Android build, and set accessibility text size separately. The
shipping workflow additionally runs the complete pre-push gate and required `CI gate`.

## Open findings and owner actions

| Priority | Owner | Exact next action |
| --- | --- | --- |
| Submission blocker | App owner | Enter actual App Review contact details and appropriate review notes, then select the intended processed build for version 1.0. No values were invented during this audit. |
| Submission-critical evidence | Release maintainer / app owner | Build and identify the changed signed archive/AAB; verify packaged SDK, manifests, entitlements/signing, Android native-library/page-size applicability, and processed build. Review App Privacy/Data safety, age rating/target audience, export compliance, agreements/pricing/availability, applicable trader status, foreground-service declarations, Play production access and pre-launch/policy reports in the consoles. |
| Major coverage gap | QA / release maintainer | Run VoiceOver and TalkBack, full keyboard/Switch Control where applicable, physical-device audio interruptions/routes/lock-screen/widget controls, upgrade/process recreation, and native locale/appearance/rotation coverage. Include Safari/Firefox, enlarged web text, unavailable storage, and offline startup versus an already-loaded page. |
| Minor visual accessibility issue | Native UI maintainer | Make history axis labels readable at enlarged text: Android at font scale 2.0 clips calendar dates to indistinguishable prefixes; iOS uses fixed 10pt labels that can shrink to 6pt. Test scalable/reflowing labels or a readable detail alternative. Existing semantic bar descriptions and sound totals do not fix the visual limitation. |
| Deployment prerequisite | Release maintainer | Deploy the merged web candidate and recheck live privacy/support wording and displayed version. The audit's HTTP 200 checks alone do not establish that the corrected copy is live. |

## Current requirements and interpretation

Official sources were accessed October 19, 2026. Apple lists Xcode 26+/iOS 26 SDK uploads
from April 28, 2026, and minimum deployment target iOS 13 from September 9, 2026. Source
minimum iOS 18 meets the latter; installed Xcode does not prove a release archive's SDK.
[Apple upcoming requirements](https://developer.apple.com/news/upcoming-requirements/).
Google's phone/tablet new-app/update floor is target API 36 from August 31, 2026. Source
target 36 meets that floor without an extension; compile SDK 37 alone would not prove it.
[Google target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878).

Privacy declarations must match actual data flows and SDKs, including the distinction
between local data and collection. Actual console answers were not inferred from source.
[Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/),
[Google Data safety](https://support.google.com/googleplay/android-developer/answer/10787469).

The chosen web assessment reference is WCAG 2.2 AA, not a blanket conformance claim.
Native design guidance is separate from mandatory store policies and web target-size rules.
[WCAG 2.2](https://www.w3.org/TR/WCAG22/),
[WAI modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/),
[Compose accessibility defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults).
Apple HIG and privacy-manifest documentation returned JavaScript shells in the available
reader; this audit does not assert numeric requirements from their unseen text. The skill
now recommends an official linked/text/JSON fallback before marking a source unverified.

## Skill validation

The skill has one coordinating procedure with separate iOS, Android, and web references,
plus invocation metadata. The skill-creator validator passed. A separate agent ran an
independent report-only forward test: it respected the read-only boundary, distinguished
source/console/runtime evidence, found the live-page mismatch and small iOS chart-label
risk, and did not claim runtime checks had passed. Its documentation fallback suggestion
was incorporated. Reusable instructions live in the skill; this dated record is deliberately
separate so future audits must check current policies and actual candidates again.
