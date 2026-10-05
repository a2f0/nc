#!/bin/sh
set -eu

# Checks the iOS audio renderer's output: compiles ios/Shared's renderer with the offline
# rendering checks in ios/AudioTests for macOS, and runs them. Requires Xcode.

REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)"

build_dir=$(mktemp -d "${TMPDIR:-/tmp}/audio-tests.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT
trap 'exit 1' HUP INT TERM

xcrun swiftc -O -o "$build_dir/audio-tests" \
  "$REPO_ROOT/ios/Shared/NoiseType.swift" \
  "$REPO_ROOT/ios/Shared/NoiseGenerator.swift" \
  "$REPO_ROOT/ios/Shared/NoiseRenderer.swift" \
  "$REPO_ROOT/ios/AudioTests/main.swift"
"$build_dir/audio-tests"
