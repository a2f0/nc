# Noise Connoisseur

Player for white, pink, and brown noise, a fan, and ocean waves, native on `ios/` (SwiftUI,
WidgetKit) and `android/` (Jetpack Compose, Glance), plus a desktop web version in `web/`
(TypeScript, AudioWorklet). There is no shared code between them; their strings come from
`l10n/`. See `README.md` for architecture, setup, and releasing.

## Setup

```sh
mise install && bundle install && bun install
brew install imagemagick
sh scripts/git/install-hooks.sh
sh scripts/ensureGradleWrapper.sh
```

## Validation

The pre-push hook (`scripts/git/hooks/pre-push`) is the full local gate; CI runs the same
checks. Run individual pieces while iterating:

```sh
sh scripts/checks/lintScripts.sh                       # ShellCheck
sh scripts/checks/checkBinaryFiles.sh --all            # no binary files
bun run agents:check                                   # shared skills are current
bun run l10n:check                                     # translations, generated strings, store listings
bun run test                                           # fastlane helper, web, and localization tests
bun run web:check && bun run web:build                 # web typecheck and build
bunx wrangler deploy --config web/wrangler.jsonc --dry-run   # web deploy config
(cd android && ./gradlew assembleDebug lintDebug testDebugUnitTest)
xcodebuild -quiet -project ios/NoiseConnoisseur.xcodeproj -scheme NoiseConnoisseur \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
sh scripts/checks/testIosAudio.sh                      # iOS renderer, rendered offline on macOS
```

Changes to app behavior should also be checked in a simulator, emulator, or browser
(`bun run web:dev`); `sh scripts/takeScreenshots.sh` drives the mobile apps end to end. On
Android it runs the minified (R8) release build: debug builds aren't minified, so they can
hide release-only crashes.

## Conventions

- Branches: `<type>/<name>`, e.g. `feat/sleep-timer`. Commits and PR titles: Conventional
  Commits, at most 50 characters, lowercase subject. Commits are signed and carry no
  `Co-authored-by` trailers.
- No binary files in Git. Icons and launch images are generated from `assets/*.svg` and
  gitignored; edit the SVGs, never the PNGs. The Gradle wrapper jar is regenerated.
- Store credentials live in `.secrets/` (a gitignored symlink). Never copy secrets into
  the repository.
- Grayscale only: nothing in the apps, the app icon, the website, or the store graphics and
  screenshots has color. Use black, white, and grays with equal red, green, and blue, and
  don't fall back on system or theme colors that carry a hue: Material's baseline and dynamic
  (wallpaper) colors, iOS's slightly blue label, fill, and separator colors, a colored accent,
  or the browser's focus and selection colors. The palettes are
  `android/app/src/main/java/net/a2f0/nc/ui/Colors.kt` (`ColorsTest` checks every role),
  `ios/Shared/Gray.swift`, and `web/styles.css`; the icon is `assets/*.svg`.
- Strings: every user-facing string is in `l10n/strings.ts`, with a comment for translators,
  and `bun run l10n` writes each platform's string files from it and the translations; never
  edit `strings.xml` or `Localizable.xcstrings` directly. Use `R.string.*` on Android, the
  generated symbols on iOS (`Text(.volume)`, or `LocalizedStringResource("key")` in App
  Intents' metadata), and `t()` from `web/src/l10n.ts` on the web. See "Localization" in
  `README.md`.
- Keep the apps' behavior in step: a feature or fix on one platform usually needs the same
  change on the others. The web app has no widget, and its noise generator must keep
  matching the native ones (`web/test/noiseGenerator.test.ts` compares it with iOS output).

## Shipping

Use the `update-dependencies` skill for dependency upgrades, including runtime,
native, and CI pins. Follow its compatibility, audit, and infrastructure-preview
gates before running setup, hooks, or workflows with the proposed versions.

Use the `ship-pr` skill with `agent-tool` (`bun run agent-tool ...`). Review with an agent
other than the one that wrote the change. The required check is `CI gate`; packages are not
versioned. `bun run agents:sync` updates the shared skills after an `@a2f0/agent-tool`
upgrade. Merging doesn't deploy the web app; `bun run web:deploy` publishes it to
`nc.a2f0.net` (see "Releasing" in `README.md`).
