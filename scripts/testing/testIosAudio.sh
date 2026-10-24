#!/bin/sh
set -eu

# Checks the iOS audio renderer, history model, and real localization catalog on macOS.
# Compiles the shared sources with their focused test harnesses. Requires Xcode.

REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)"

build_dir=$(mktemp -d "${TMPDIR:-/tmp}/audio-tests.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT
trap 'exit 1' HUP INT TERM

# The Xcode project's strict settings (ios/Config/Base.xcconfig) and Swift 6 language mode.
set -- -swift-version 6 -warnings-as-errors -strict-memory-safety \
  -enable-upcoming-feature ExistentialAny -enable-upcoming-feature MemberImportVisibility

# NoiseType.swift uses the string symbols Xcode generates from the String Catalog.
xcrun xcstringstool generate-symbols "$REPO_ROOT/ios/Shared/Localizable.xcstrings" \
  --output-directory "$build_dir" --language swift
xcrun swiftc "$@" -O -o "$build_dir/audio-tests" \
  "$build_dir/GeneratedStringSymbols_Localizable.swift" \
  "$REPO_ROOT/ios/Shared/NoiseType.swift" \
  "$REPO_ROOT/ios/Shared/NoiseGenerator.swift" \
  "$REPO_ROOT/ios/Shared/NoiseRenderer.swift" \
  "$REPO_ROOT/ios/AudioTests/main.swift"
"$build_dir/audio-tests"

# The local history model has no UIKit dependency and can also be checked on macOS.
xcrun swiftc "$@" -parse-as-library -o "$build_dir/history-tests" \
  "$REPO_ROOT/ios/Shared/ListeningHistory.swift" \
  "$REPO_ROOT/ios/HistoryTests/main.swift"
"$build_dir/history-tests"

# Playback diagnostics persist bounded events and recover interrupted processes.
xcrun swiftc "$@" -parse-as-library -o "$build_dir/playback-log-tests" \
  "$build_dir/GeneratedStringSymbols_Localizable.swift" \
  "$REPO_ROOT/ios/Shared/PlaybackLog.swift" \
  "$REPO_ROOT/ios/PlaybackLogTests/main.swift"
"$build_dir/playback-log-tests"

# Use a real app bundle so the generated symbols resolve the compiled catalog.
language_app="$build_dir/LanguageTests.app/Contents"
mkdir -p "$language_app/MacOS" "$language_app/Resources"
cat > "$language_app/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>net.a2f0.nc.language-tests</string>
<key>CFBundleExecutable</key><string>language-tests</string>
<key>CFBundleDevelopmentRegion</key><string>en</string>
</dict></plist>
PLIST
xcrun xcstringstool compile "$REPO_ROOT/ios/Shared/Localizable.xcstrings" \
  --output-directory "$language_app/Resources"
xcrun swiftc "$@" -o "$language_app/MacOS/language-tests" \
  "$build_dir/GeneratedStringSymbols_Localizable.swift" \
  "$REPO_ROOT/ios/Shared/AppLanguage.swift" \
  "$REPO_ROOT/ios/Shared/LanguageSettings.swift" \
  "$REPO_ROOT/ios/LanguageTests/main.swift"
"$language_app/MacOS/language-tests"
