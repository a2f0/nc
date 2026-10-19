#!/bin/sh
set -eu

# Checks the iOS audio renderer's output: compiles ios/Shared's renderer with the offline
# rendering checks in ios/AudioTests for macOS, and runs them. Requires Xcode.

REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)"

build_dir=$(mktemp -d "${TMPDIR:-/tmp}/audio-tests.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT
trap 'exit 1' HUP INT TERM

# NoiseType.swift uses the string symbols Xcode generates from the String Catalog.
xcrun xcstringstool generate-symbols "$REPO_ROOT/ios/Shared/Localizable.xcstrings" \
  --output-directory "$build_dir" --language swift
xcrun swiftc -O -o "$build_dir/audio-tests" \
  "$build_dir/GeneratedStringSymbols_Localizable.swift" \
  "$REPO_ROOT/ios/Shared/NoiseType.swift" \
  "$REPO_ROOT/ios/Shared/NoiseGenerator.swift" \
  "$REPO_ROOT/ios/Shared/NoiseRenderer.swift" \
  "$REPO_ROOT/ios/AudioTests/main.swift"
"$build_dir/audio-tests"

# The local history model has no UIKit dependency and can also be checked on macOS.
xcrun swiftc -parse-as-library -o "$build_dir/history-tests" \
  "$REPO_ROOT/ios/Shared/ListeningHistory.swift" \
  "$REPO_ROOT/ios/HistoryTests/main.swift"
"$build_dir/history-tests"
