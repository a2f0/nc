#!/bin/sh
set -eu

# Check the Swift sources: SwiftFormat (.swiftformat) for layout and SwiftLint
# (.swiftlint.yml) for the rest, where every warning fails. With --format, fix what
# each can first.

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

for tool in swiftformat swiftlint; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Error: $tool is required (mise install)." >&2
    exit 1
  }
done

if [ "${1:-}" = "--format" ]; then
  swiftformat --quiet ios
  swiftlint lint --fix --quiet
fi
swiftformat --lint --quiet ios
swiftlint lint --strict --quiet
