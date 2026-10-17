#!/bin/sh
set -eu

# Render the images that agent-tool.json declares from assets/brand/*.svg, with
# agent-tool (https://github.com/a2f0/agent-tool/blob/main/docs/images.md). With no
# target, builds every target that has a dir: ios and android. The store and web
# targets have none, so they need --out, which is relative to the repo root. The
# Gradle generateImages task and `fastlane android listing` run this.
#
# The Xcode build phase passes --xcode. User script sandboxing lets a phase write
# only its declared output files, while agent-tool replaces each file through a
# temporary file beside it, so this renders the target into a temporary directory
# and copies each file that changed into the target's dir.
#
# Usage: buildImages.sh [target...] [--out <dir>]
#        buildImages.sh --xcode <target>

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

if [ "${1:-}" != --xcode ]; then
  exec "$AGENT_TOOL" --repo "$REPO_ROOT" images build "$@"
fi

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 --xcode <target>" >&2
  exit 2
fi
target=$2
list=$("$AGENT_TOOL" --repo "$REPO_ROOT" images list "$target")
dir=$(printf '%s' "$list" | bun -e '
  const { name, dir } = JSON.parse(await Bun.stdin.text()).targets[0];
  if (typeof dir !== "string") {
    console.error("Error: image target " + name + " has no dir to copy into.");
    process.exit(1);
  }
  console.log(dir);
')
staging=$(mktemp -d "${TMPDIR:-/tmp}/nc-images.XXXXXX")
trap 'rm -rf "$staging"' EXIT
trap 'exit 1' HUP INT TERM

"$AGENT_TOOL" --repo "$REPO_ROOT" images build "$target" --out "$staging" >/dev/null
(cd "$staging" && find . -type f) | while IFS= read -r file; do
  file=${file#./}
  destination="$REPO_ROOT/$dir/$file"
  if ! cmp -s "$staging/$file" "$destination"; then
    mkdir -p "$(dirname "$destination")"
    cp "$staging/$file" "$destination"
    echo "Wrote $dir/$file"
  fi
done
