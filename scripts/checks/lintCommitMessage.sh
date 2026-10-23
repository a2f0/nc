#!/bin/sh
set -eu

# Keep nc's stricter header grammar around the shared commit policy.
[ "$#" -eq 1 ] || {
  echo "Usage: $0 <commit-message-file>" >&2
  exit 2
}

normalized=$(mktemp)
trap 'rm -f "$normalized"' EXIT
trap 'exit 1' HUP INT TERM
awk '!/^#/ { if (started || /[^[:space:]]/) { print; started = 1 } }' "$1" >"$normalized"
header=$(sed -n '1p' "$normalized")

fail() {
  echo "Error: $1" >&2
  printf '  %s\n' "$header" >&2
  exit 1
}

case "$header" in
  "Merge "* | "Revert \""* | "fixup! "* | "squash! "* | "amend! "* | "Initial commit") ;;
  *)
    # The shared checker permits broader scopes and strips a squash PR suffix.
    # Check nc's whole header here, with the configured limit as the single source.
    limit=$(bun -e 'const p = await Bun.file("agent-tool.json").json(); console.log(p.subject.maxLength)')
    length=$(printf '%s' "$header" | wc -m | tr -d ' ')
    [ "$length" -le "$limit" ] || fail "header is $length characters; the limit is $limit."
    printf '%s\n' "$header" | grep -qE '^[a-z]+(\([a-z0-9._/-]+\))?!?: [^ ]' ||
      fail "expected a Conventional Commits header with a lowercase scope."
    subject=${header#*: }
    case "$subject" in
      [[:upper:]]*) fail "subject must not start with an uppercase letter." ;;
      *.) fail "subject must not end with a period." ;;
    esac
    ;;
esac

bun run --silent agent-tool commits check --message-file "$normalized"
