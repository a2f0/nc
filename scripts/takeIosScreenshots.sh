#!/bin/sh
set -eu

# Build the iOS app, drive it with Maestro on dedicated simulators, and write
# App Store screenshots below the gitignored .screenshots/ios/.

# shellcheck source=scripts/lib/screenshots.sh
. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)/lib/screenshots.sh"

require_command maestro "See https://maestro.mobile.dev."
require_command xcrun "Install Xcode."
require_command jq "Run mise install, or brew install jq."
require_command magick "Run brew install imagemagick."

REPO_ROOT=$SCREENSHOTS_REPO_ROOT
OUTPUT_DIR="$SCREENSHOT_OUTPUT_ROOT/ios"
MAESTRO_OUTPUT_DIR="$OUTPUT_DIR/maestro"
BUILD_DIR="${TMPDIR:-/tmp}/noise-connoisseur-screenshots-derived-data"
RUNTIME_VERSION="${IOS_SCREENSHOT_RUNTIME_VERSION:-26.2}"
BUNDLE_ID=net.a2f0.nc
APP_PATH="$BUILD_DIR/Build/Products/Debug-iphonesimulator/NoiseConnoisseur.app"

# Device type and expected screenshot size per device. These are the sizes
# App Store Connect requires: 6.9" iPhone and 13" iPad.
DEVICES="iphone ipad"
device_type() {
  case "$1" in
    iphone) echo com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro-Max ;;
    ipad) echo com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M4-8GB ;;
  esac
}
device_screenshot_size() {
  case "$1" in
    iphone) echo 1320x2868 ;;
    ipad) echo 2064x2752 ;;
  esac
}

runtime_identifier="$(
  xcrun simctl list runtimes available -j |
    jq -r --arg version "$RUNTIME_VERSION" \
      '[.runtimes[] | select(.version == $version and .isAvailable == true)] | first | .identifier // empty'
)"
[ -n "$runtime_identifier" ] || {
  echo "Error: no iOS $RUNTIME_VERSION simulator runtime is installed." >&2
  echo "Install it in Xcode, or set IOS_SCREENSHOT_RUNTIME_VERSION." >&2
  exit 1
}

# Find or create a simulator reserved for screenshots, so captures never
# depend on (or disturb) whatever state a day-to-day simulator is in.
dedicated_simulator() {
  name=$1
  type=$2
  udid="$(
    xcrun simctl list devices available -j |
      jq -r --arg name "$name" --arg runtime "$runtime_identifier" --arg type "$type" \
        '[.devices[$runtime][]? | select(.name == $name and .deviceTypeIdentifier == $type)] | first | .udid // empty'
  )"
  if [ -z "$udid" ]; then
    udid="$(xcrun simctl create "$name" "$type" "$runtime_identifier")"
  fi
  printf '%s\n' "$udid"
}

echo "Building the iOS app..."
xcodebuild \
  -quiet \
  -project "$REPO_ROOT/ios/NoiseConnoisseur.xcodeproj" \
  -scheme NoiseConnoisseur \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$BUILD_DIR" \
  CODE_SIGNING_ALLOWED=NO \
  build

udid=""
cleanup() {
  [ -n "$udid" ] || return 0
  xcrun simctl status_bar "$udid" clear >/dev/null 2>&1 || true
  xcrun simctl ui "$udid" appearance light >/dev/null 2>&1 || true
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# capture <device> <flow> <appearance: light|dark> <file>
capture() {
  xcrun simctl ui "$udid" appearance "$3"
  maestro --platform ios --device "$udid" test \
    --test-output-dir "$MAESTRO_OUTPUT_DIR" "$SCREENSHOT_FLOWS_DIR/$2.yaml" >/dev/null
  # SpringBoard applies status bar and appearance changes asynchronously.
  sleep 2
  screenshot="$OUTPUT_DIR/$1/$4"
  # --mask=black flattens the rounded display corners and drops alpha.
  xcrun simctl io "$udid" screenshot --type=png --mask=black "$screenshot" >/dev/null 2>&1
  validate_screenshot "$screenshot" "$(device_screenshot_size "$1")"
}

mkdir -p "$MAESTRO_OUTPUT_DIR"

for device in $DEVICES; do
  udid=$(dedicated_simulator "Noise Connoisseur Screenshots ($device)" "$(device_type "$device")")
  echo "Capturing $device on $udid..."

  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl terminate "$udid" "$BUNDLE_ID" 2>/dev/null || true
  xcrun simctl install "$udid" "$APP_PATH"
  xcrun simctl status_bar "$udid" override \
    --time 9:41 \
    --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 \
    --batteryState charged --batteryLevel 100
  mkdir -p "$OUTPUT_DIR/$device"

  capture "$device" home light 01-home.png
  capture "$device" playing light 02-playing.png
  capture "$device" playing dark 03-playing-dark.png
  xcrun simctl terminate "$udid" "$BUNDLE_ID" 2>/dev/null || true
  cleanup
done
