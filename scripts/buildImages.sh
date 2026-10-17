#!/bin/sh
set -eu

# Render the images that agent-tool.json declares from assets/brand/*.svg, with
# agent-tool (https://github.com/a2f0/agent-tool/blob/main/docs/images.md). With no
# target, builds every target that has a dir: ios and android. The store and web
# targets have none, so they need --out, which is relative to the repo root. The
# Xcode build phase, the Gradle generateImages task, and `fastlane android listing`
# run this. Under Xcode's user script sandbox, which allows writing only a phase's
# declared outputs, agent-tool rewrites those files in place.
#
# Usage: buildImages.sh [target...] [--out <dir>]

REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)"
AGENT_TOOL="$REPO_ROOT/node_modules/.bin/agent-tool"

# Xcode and Android Studio run builds with a minimal PATH, and agent-tool runs on Bun.
PATH="$PATH:$HOME/.bun/bin:$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin"
export PATH

if [ ! -e "$AGENT_TOOL" ]; then
  echo "Error: agent-tool isn't installed; run bun install in $REPO_ROOT." >&2
  exit 1
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "Error: Bun is required to build images (mise install, or see https://bun.sh)." >&2
  exit 1
fi

exec "$AGENT_TOOL" --repo "$REPO_ROOT" images build "$@"
