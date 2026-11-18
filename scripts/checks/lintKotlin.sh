#!/bin/sh
set -eu

# Check the Kotlin sources and Gradle scripts with ktlint, in the style .editorconfig sets.
# With --format, fix what ktlint can first.

CDPATH='' cd -P -- "$(dirname -- "$0")/../.."

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
. ./scripts/checks/lib/lintFiles.sh
files=$(mktemp)
trap 'rm -f "$files"' EXIT
list_lint_files '*.kt' '*.kts' > "$files"
[ ! -s "$files" ] || xargs -0 ktlint --relative "$@" < "$files"
