#!/bin/sh
set -eu

# Build the Android app, drive it with Maestro on a dedicated headless
# emulator, and write Google Play screenshots below the gitignored
# .screenshots/android/.

# shellcheck source=scripts/lib/screenshots.sh
. "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)/lib/screenshots.sh"

ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
PATH="$ANDROID_SDK/platform-tools:$ANDROID_SDK/emulator:$ANDROID_SDK/cmdline-tools/latest/bin:$PATH"
export PATH

require_command maestro "See https://maestro.mobile.dev."
require_command adb "Install the Android SDK platform-tools."
require_command emulator "Install the Android SDK emulator."
require_command avdmanager "Install the Android SDK command-line tools."
require_command magick "Run brew install imagemagick."

REPO_ROOT=$SCREENSHOTS_REPO_ROOT
OUTPUT_DIR="$SCREENSHOT_OUTPUT_ROOT/android"
MAESTRO_OUTPUT_DIR="$OUTPUT_DIR/maestro"
APP_ID=net.a2f0.nc
AVD_NAME=NoiseConnoisseur_Screenshots
SYSTEM_IMAGE="${ANDROID_SCREENSHOT_SYSTEM_IMAGE:-system-images;android-35;google_apis_playstore;arm64-v8a}"
# Pixel 2 is 1080x1920: Google Play rejects screenshots whose long side is
# more than twice the short side, which rules out most modern phone shapes.
DEVICE_PROFILE=pixel_2
EXPECTED_SIZE=1080x1920
# A fixed port keeps this emulator's serial distinct from any others running.
EMULATOR_PORT=5584
SERIAL="emulator-$EMULATOR_PORT"

if ! emulator -list-avds | grep -qx "$AVD_NAME"; then
  echo "Creating the $AVD_NAME emulator..."
  echo no | avdmanager --silent create avd --name "$AVD_NAME" \
    --package "$SYSTEM_IMAGE" --device "$DEVICE_PROFILE" >/dev/null
fi

# A minified release build, so this run exercises the same R8 output that ships (debug
# builds aren't minified). It's signed with the local debug key, only to install it here.
echo "Building the Android app (release)..."
sh "$REPO_ROOT/scripts/ensureGradleWrapper.sh"
(cd "$REPO_ROOT/android" && ./gradlew --quiet assembleRelease \
  -Pandroid.injected.signing.store.file="$HOME/.android/debug.keystore" \
  -Pandroid.injected.signing.store.password=android \
  -Pandroid.injected.signing.key.alias=androiddebugkey \
  -Pandroid.injected.signing.key.password=android)

mkdir -p "$OUTPUT_DIR/phone" "$MAESTRO_OUTPUT_DIR"
emulator_log="$OUTPUT_DIR/emulator.log"

cleanup() {
  adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null 2>&1 || true
  adb -s "$SERIAL" shell cmd uimode night no >/dev/null 2>&1 || true
  adb -s "$SERIAL" emu kill >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Booting $AVD_NAME..."
emulator -avd "$AVD_NAME" -port "$EMULATOR_PORT" -no-window -no-audio \
  -no-snapshot -no-boot-anim >"$emulator_log" 2>&1 &
adb -s "$SERIAL" wait-for-device
until [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  sleep 2
done

# A fresh install: an earlier build may have a higher version code or another signature.
adb -s "$SERIAL" uninstall "$APP_ID" >/dev/null 2>&1 || true
adb -s "$SERIAL" install "$REPO_ROOT/android/app/build/outputs/apk/release/app-release.apk" >/dev/null

# System UI demo mode: a clean, fixed status bar.
demo() {
  adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null
}
adb -s "$SERIAL" shell settings put global sysui_demo_allowed 1
demo enter
demo clock -e hhmm 0941
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4 -e fully true
demo network -e mobile hide
demo notifications -e visible false

# capture <flow> <night: yes|no> <file>
capture() {
  adb -s "$SERIAL" shell cmd uimode night "$2" >/dev/null
  maestro --device "$SERIAL" test \
    --test-output-dir "$MAESTRO_OUTPUT_DIR" "$SCREENSHOT_FLOWS_DIR/$1.yaml" >/dev/null
  sleep 2
  screenshot="$OUTPUT_DIR/phone/$3"
  # screencap writes RGBA; Play wants no alpha channel.
  adb -s "$SERIAL" exec-out screencap -p | magick png:- -alpha off -type TrueColor "PNG24:$screenshot"
  validate_screenshot "$screenshot" "$EXPECTED_SIZE"
}

echo "Capturing phone on $SERIAL..."
capture home no 01-home.png
capture playing no 02-playing.png
capture playing yes 03-playing-dark.png
adb -s "$SERIAL" shell am force-stop "$APP_ID"
