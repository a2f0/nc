# Repository scripts

Run commands from the repository root. Existing package scripts in `package.json`
remain the supported entrypoints for web, localization, release, and agent workflows.
See [development](../docs/development.md) for the full local gate and generated assets,
and [releasing](../docs/releasing.md) for store workflows.

| Directory | Purpose and entrypoints |
| --- | --- |
| `build/` | `buildImages.sh [target...] [--out directory]` supplies native build environments to agent-tool image rendering. |
| `checks/` | Shell, branch, commit-message, commit-trust, and binary-file checks used by hooks and CI. |
| `dev/` | `ensureGradleWrapper.sh` regenerates the gitignored Gradle wrapper jar. |
| `git/` | Hook installation and tracked hook bodies under `git/hooks/`. |
| `testing/` | `takeScreenshots.sh [ios\|android]`, platform screenshot drivers, native iOS test runners, and Android evidence recording. |
| `testing/lib/` | Helpers used only by screenshot test drivers. |

The Android evidence recorder is invoked by its fastlane lane; use that lane rather
than calling the recorder directly. Web build/development tools stay with `web/`,
localization generation/reporting with `l10n/`, and native store tooling with `fastlane/`.
Do not introduce a second implementation of shared agent-tool commands in this tree.
