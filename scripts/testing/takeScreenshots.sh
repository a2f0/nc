#!/bin/sh
set -eu

# Capture store screenshots for iOS (iPhone 6.9" and iPad 13") and Android
# (phone) in light and dark appearance. Writes PNGs below the gitignored
# .screenshots/ at the repo root.
#
# Usage: takeScreenshots.sh [ios|android]   (default: both)
# Requires: Maestro (https://maestro.mobile.dev), Xcode, the Android SDK, jq,
# and ImageMagick.

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"

case "${1:-all}" in
  ios) sh "$SCRIPT_DIR/takeIosScreenshots.sh" ;;
  android) sh "$SCRIPT_DIR/takeAndroidScreenshots.sh" ;;
  all)
    sh "$SCRIPT_DIR/takeIosScreenshots.sh"
    sh "$SCRIPT_DIR/takeAndroidScreenshots.sh"
    ;;
  *)
    echo "Usage: $0 [ios|android]" >&2
    exit 2
    ;;
esac
