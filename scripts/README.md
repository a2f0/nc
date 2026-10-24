# Repository scripts

Run commands from the repository root. Existing package scripts in `package.json`
remain the supported entrypoints for web, localization, release, and agent workflows.
See [development](../docs/development.md) for the full local gate and generated assets,
and [releasing](../docs/releasing.md) for store workflows.

| Directory | Purpose and entrypoints |
| --- | --- |
| `build/` | `buildImages.sh [target...] [--out directory]` supplies native build environments to agent-tool image rendering. |
| `checks/` | Shell lint; Kotlin (`lintKotlin.sh`) and Swift (`lintSwift.sh`) lint, which fix what they can with `--format`; nc's stricter commit-header adapter; and the CI aggregate policy. Shared Git checks use agent-tool. |
| `dev/` | `ensureGradleWrapper.sh` regenerates the gitignored Gradle wrapper jar. |
| `git/hooks/` | Tracked hook bodies; agent-tool handles installation and drift checks. |
| `testing/` | The full `check.json` validation group, workflow adapter tests, `takeScreenshots.sh [ios\|android]`, platform screenshot drivers, native iOS test runners, and Android evidence recording. |
| `testing/lib/` | Helpers used only by screenshot test drivers. |

The Android evidence recorder is invoked by its fastlane lane; use that lane rather
than calling the recorder directly. Web build/development tools stay with `web/`,
localization generation/reporting with `l10n/`, and native store tooling with `fastlane/`.
Do not introduce a second implementation of shared agent-tool commands in this tree.
