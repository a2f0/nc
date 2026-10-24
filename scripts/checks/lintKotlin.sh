#!/bin/sh
set -eu

# Check the Kotlin sources and Gradle scripts with ktlint, in the style .editorconfig sets.
# With --format, fix what ktlint can first.

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

command -v ktlint >/dev/null 2>&1 || {
  echo "Error: ktlint is required (mise install)." >&2
  exit 1
}

if [ "${1:-}" = "--format" ]; then
  set -- --format
else
  set --
fi

# Tracked and untracked-but-not-ignored sources.
git ls-files --cached --others --exclude-standard -z -- '*.kt' '*.kts' |
  xargs -0 ktlint --relative "$@"
