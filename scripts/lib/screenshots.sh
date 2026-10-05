# shellcheck shell=sh
# Shared by scripts/takeIosScreenshots.sh and scripts/takeAndroidScreenshots.sh.

SCREENSHOTS_REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)"
# shellcheck disable=SC2034 # read by the scripts that source this file
SCREENSHOT_FLOWS_DIR="$SCREENSHOTS_REPO_ROOT/maestro/screenshots"
# shellcheck disable=SC2034
SCREENSHOT_OUTPUT_ROOT="${SCREENSHOT_OUTPUT_DIR:-$SCREENSHOTS_REPO_ROOT/.screenshots}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Error: $1 is required. $2" >&2
    exit 1
  }
}

# validate_screenshot <png> <width>x<height>
# Stores reject screenshots with the wrong size or an alpha channel.
validate_screenshot() {
  screenshot=$1
  expected=$2
  [ -s "$screenshot" ] || {
    echo "Error: $screenshot was not captured." >&2
    exit 1
  }
  dimensions=$(magick identify -format '%wx%h' "$screenshot")
  [ "$dimensions" = "$expected" ] || {
    echo "Error: $screenshot is $dimensions; expected $expected." >&2
    exit 1
  }
  # e.g. "srgb  3.0" for RGB, "srgba  4.0" with alpha.
  case "$(magick identify -format '%[channels]' "$screenshot")" in
    *a\ * | *a)
      echo "Error: $screenshot has an alpha channel; store screenshots cannot." >&2
      exit 1
      ;;
  esac
  echo "  Captured $screenshot ($dimensions)"
}
