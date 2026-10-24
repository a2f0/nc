# Noise Connoisseur

Player for white, pink, and brown noise, a fan, and ocean waves, native on `ios/` (SwiftUI,
WidgetKit) and `android/` (Jetpack Compose, Glance), plus a desktop web version in `web/`
(TypeScript, AudioWorklet). There is no shared code between them; their strings come from
`l10n/`. See [README.md](README.md) for setup and normal commands,
[development](docs/development.md) for repository layout, [architecture](docs/architecture.md)
for app behavior, and [releasing](docs/releasing.md) for publishing.

## Setup

```sh
mise install && bundle install && bun install
bun x --no-install playwright install --with-deps chromium
bun run hooks:install
sh scripts/dev/ensureGradleWrapper.sh
```

Existing clones migrating from the old hook installer must inspect their installed
hooks, then run `bun run hooks:install --adopt` once; see [development](docs/development.md#git-hooks).

## Validation

`bun run check` (`scripts/testing/check.json`) is the full local gate. Pre-push checks
its actual pushed refs and managed hook installation, then runs the same gate as CI.
The group records each command, source fingerprint, and private log; run it directly
to keep its structured receipt visible. Do not wrap a standalone group invocation
in another capture command. A captured push includes its hook's group receipt in
the push log; inspect it there or with `agent-tool runs list --head <commit>`.

For agent sessions, use `bun run --silent agent:run --label <name> -- <command> [args...]`
for finite noisy commands, including tests, builds, and pushes through the full
pre-push hook. The harness preserves the exit status, stores complete output in a private
temporary log, and prints a compact receipt plus a bounded tail on failure. Inspect a
needed excerpt with `bun run --silent agent-tool logs <log-path>`; success alone does not
establish that warnings are absent. Keep review findings, version preparation, audit
reports, and infrastructure decisions visible by running those commands directly. Run
interactive commands and development servers directly too.

Run individual pieces while iterating:

```sh
bun run lint:scripts                                  # ShellCheck
bun run lint:kotlin                                   # ktlint (bun run format:kotlin fixes)
bun run lint:swift                                    # SwiftFormat and SwiftLint (bun run format:swift fixes)
bundle exec rubocop                                   # Ruby: fastlane lanes and helpers, scripts
bun run lint:binary-files --all                       # no binary files
bun run agents:check                                  # shared skills are current
bun run l10n:check                                    # translations, generated strings, store listings
bun run test                                          # fastlane, web, localization, and workflow tests
bun run web:check && bun run web:build                # web typecheck and build
bun run web:deploy:preview                            # web deploy config
(cd android && ./gradlew assembleDebug lintDebug testDebugUnitTest detektMain detektTest)
xcodebuild -quiet -project ios/NoiseConnoisseur.xcodeproj -scheme NoiseConnoisseur \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
sh scripts/testing/testIosPlayback.sh                 # iOS player lifecycle on an isolated simulator
sh scripts/testing/testIosAudio.sh                    # iOS renderer, rendered offline on macOS
```

Changes to app behavior should also be checked in a simulator, emulator, or browser
(`bun run web:dev`); `sh scripts/testing/takeScreenshots.sh` drives the mobile apps end to end. On
Android it runs the minified (R8) release build: debug builds aren't minified, so they can
hide release-only crashes.

## Conventions

- Branches: `<type>/<name>`, e.g. `feat/sleep-timer`. Commits and PR titles: Conventional
  Commits, at most 50 characters, lowercase subject. Commits are signed and carry no
  `Co-authored-by` trailers.
- Native code quality is enforced, not advisory: compiler warnings are errors on both
  platforms; Android Lint runs every check (`android/app/lint.xml`) with Slack's Compose
  rules, plus detekt (`android/app/detekt.yml`) and ktlint (`.editorconfig`); Swift has
  SwiftFormat (`.swiftformat`), SwiftLint (`.swiftlint.yml`), and strict memory safety. Fix a
  finding rather than suppressing it. When a rule can't apply, suppress it as narrowly as
  possible, at the line or in the config, with the reason beside it. See
  [development](docs/development.md#native-code-quality).
- No binary files in Git. Icons and launch images are generated from `assets/brand/*.svg`
  as the `images` section of `agent-tool.json` declares, and gitignored; edit the SVGs or
  that section, never the PNGs. The Gradle wrapper jar is regenerated.
- Store credentials live in `.secrets/prod/`; `.secrets` is a gitignored symlink to
  `../matrix-secrets/nc`, managed and backed up from a2f0/matrix (see
  [releasing](docs/releasing.md)). Never copy secrets into the repository.
- Grayscale only: nothing in the apps, the app icon, the website, or the store graphics and
  screenshots has color. Use black, white, and grays with equal red, green, and blue, and
  don't fall back on system or theme colors that carry a hue: Material's baseline and dynamic
  (wallpaper) colors, iOS's slightly blue label, fill, and separator colors, a colored accent,
  or the browser's focus and selection colors. The palettes are
  `android/app/src/main/java/net/a2f0/nc/ui/Colors.kt` (`ColorsTest` checks every role),
  `ios/Shared/Gray.swift`, and `web/styles.css`; the icon is `assets/brand/*.svg`.
- Strings: every user-facing string is in `l10n/strings.ts`, with a comment for translators,
  and `bun run l10n` writes each platform's string files from it and the translations; never
  edit `strings.xml` or `Localizable.xcstrings` directly. Use `R.string.*` on Android, the
  generated symbols on iOS (`localizedText(.volume)` or `LanguageSettings.string(.volume)`,
  or `LocalizedStringResource("key")` in App Intents' metadata), and `t()` from
  `web/src/l10n.ts` on the web. See [localization](docs/localization.md).
- Keep the apps' behavior in step: a feature or fix on one platform usually needs the same
  change on the others. The web app has no widget, and its noise generator must keep
  matching the native ones (`web/test/noiseGenerator.test.ts` compares it with iOS output).

## Shipping

Use the `update-dependencies` skill for dependency upgrades, including runtime,
native, and CI pins. Follow its compatibility, audit, and infrastructure-preview
gates before running setup, hooks, or workflows with the proposed versions.
Read [dependency maintenance](docs/dependency-upgrades.md) and keep reusable
procedures and active constraints there, updating entries in place and removing
resolved ones. Put run-specific inventories, audits, validation, previews, and
held groups in the upgrade PR. Keep README focused on setup and normal usage
with a short maintenance link, without upgrade reports or duplicated agent
instructions.

Use the `ship-pr` skill with `agent-tool` (`bun run agent-tool ...`). Review with an agent
other than the one that wrote the change. The required check is `CI gate`. `bun run agents:sync`
updates the shared skills after an `@a2f0/agent-tool` upgrade; don't edit them in `.agents/skills`
or `.claude/skills`. Repository-owned skills live in `skills/`; `app-store-readiness` and the
readiness libraries are shared with balebase (see [readiness](docs/readiness.md#shared-with-balebase)).

Versions: the root `package.json` version is the website's version, shown in its About sheet.
Every shipped change moves it one patch past the base. After each base integration or repair
and before each review, run `bun run agent-tool versions prepare "$BASE_OID"`, which commits
the bumped `package.json` and `bun.lock`. Resolve a conflict confined to version fields with
`bun run agent-tool versions resolve-conflicts`, then `git commit --no-edit`. Before merging,
`bun run agent-tool versions check "$BASE_OID"` must pass against the live base. The mobile
apps' versions are separate, in `ios/Config/Base.xcconfig` and `android/app/build.gradle.kts`. Merging doesn't deploy the web app; `bun run web:deploy` publishes it to
`nc.a2f0.net` (see [releasing](docs/releasing.md)).
