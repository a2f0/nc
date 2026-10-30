# shellcheck shell=sh
# Shared by scripts/testing/takeIosScreenshots.sh and scripts/testing/takeAndroidScreenshots.sh.

SCREENSHOTS_REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)"
# shellcheck disable=SC2034 # read by the scripts that source this file
SCREENSHOT_FLOWS_DIR="$SCREENSHOTS_REPO_ROOT/maestro/screenshots"
# shellcheck disable=SC2034
SCREENSHOT_OUTPUT_ROOT="${SCREENSHOT_OUTPUT_DIR:-$SCREENSHOTS_REPO_ROOT/.screenshots}"

# A capture.json there means the folder holds a shared capture, which the
# take-screenshots skill records: it writes a running record before it runs this
# capture. Writing over a finished capture without it would leave that record
# vouching for images it didn't take, so refuse; this capture never edits it.
capture_record="$SCREENSHOT_OUTPUT_ROOT/capture.json"
if [ -e "$capture_record" ] && ! grep -Eq '"status": *"running"' "$capture_record"; then
  echo "Error: $SCREENSHOT_OUTPUT_ROOT holds a recorded shared capture; capture through the" >&2
  echo "take-screenshots skill, or set SCREENSHOT_OUTPUT_DIR to another folder for a local look." >&2
  exit 1
fi

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
