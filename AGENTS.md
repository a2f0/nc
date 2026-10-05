# Noise Connoisseur

White and pink noise player, native on `ios/` (SwiftUI, WidgetKit) and `android/` (Jetpack
Compose, Glance), plus a desktop web version in `web/` (TypeScript, AudioWorklet). There is
no shared code between them. See `README.md` for architecture, setup, and releasing.

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
bun run test                                           # fastlane helper and web audio tests
bun run web:check && bun run web:build                 # web typecheck and build
(cd android && ./gradlew assembleDebug lintDebug)
xcodebuild -quiet -project ios/NoiseConnoisseur.xcodeproj -scheme NoiseConnoisseur \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Changes to app behavior should also be checked in a simulator, emulator, or browser
(`bun run web:dev`); `sh scripts/takeScreenshots.sh` drives the mobile apps end to end.

## Conventions

- Branches: `<type>/<name>`, e.g. `feat/sleep-timer`. Commits and PR titles: Conventional
  Commits, at most 50 characters, lowercase subject. Commits are signed and carry no
  `Co-authored-by` trailers.
- No binary files in Git. Icons and launch images are generated from `assets/*.svg` and
  gitignored; edit the SVGs, never the PNGs. The Gradle wrapper jar is regenerated.
- Store credentials live in `.secrets/` (a gitignored symlink). Never copy secrets into
  the repository.
- Keep the apps' behavior in step: a feature or fix on one platform usually needs the same
  change on the others. The web app has no widget, and its noise generator must keep
  matching the native ones (`web/test/noiseGenerator.test.ts` compares it with iOS output).

## Shipping

Use the `ship-pr` skill with `agent-tool` (`bun run agent-tool ...`). Review with an agent
other than the one that wrote the change. The required check is `CI gate`; packages are not
versioned. `bun run agents:sync` updates the shared skills after an `@a2f0/agent-tool`
upgrade.
