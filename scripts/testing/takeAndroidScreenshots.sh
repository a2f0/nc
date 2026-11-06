#!/bin/sh
set -eu

# Build the Android app, drive it with Maestro on a dedicated headless
# emulator, and write Google Play screenshots below the gitignored
# .screenshots/android/.

# shellcheck source=scripts/testing/lib/screenshots.sh
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
sh "$REPO_ROOT/scripts/dev/ensureGradleWrapper.sh"
(cd "$REPO_ROOT/android" && ./gradlew --quiet assembleRelease \
  -Pandroid.injected.signing.store.file="$HOME/.android/debug.keystore" \
  -Pandroid.injected.signing.store.password=android \
  -Pandroid.injected.signing.key.alias=androiddebugkey \
  -Pandroid.injected.signing.key.password=android)

mkdir -p "$OUTPUT_DIR/phone" "$MAESTRO_OUTPUT_DIR"
emulator_log="$OUTPUT_DIR/emulator.log"

# How long the emulator may take to boot before the capture gives up.
BOOT_TIMEOUT="${ANDROID_SCREENSHOT_BOOT_TIMEOUT:-600}"

# bounded <seconds> <command...>: runs the command, stopping it after that long. adb
# can block forever on an emulator that has stopped responding.
bounded() {
  seconds=$1
  shift
  "$@" &
  bounded_pid=$!
  (
    sleep_pid=""
    trap 'kill "$sleep_pid" 2>/dev/null; exit 0' TERM
    sleep "$seconds" &
    sleep_pid=$!
    wait "$sleep_pid"
    kill "$bounded_pid" 2>/dev/null
  ) >/dev/null 2>&1 &
  watchdog_pid=$!
  bounded_status=0
  wait "$bounded_pid" || bounded_status=$?
  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  return "$bounded_status"
}

# Each boot check waits at most 10 seconds, and never past the boot deadline.
boot_poll_limit() {
  remaining=$((boot_deadline - $(date +%s)))
  if [ "$remaining" -lt 1 ]; then echo 1; elif [ "$remaining" -lt 10 ]; then echo "$remaining"; else echo 10; fi
}

emulator_pid=""
booted=false
cleanup() {
  if [ "$booted" = true ]; then
    bounded 10 adb -s "$SERIAL" shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null 2>&1 || true
    bounded 10 adb -s "$SERIAL" shell cmd uimode night no >/dev/null 2>&1 || true
    bounded 10 adb -s "$SERIAL" emu kill >/dev/null 2>&1 || true
  fi
  # The console can't stop an emulator adb doesn't see yet, or one that stopped
  # responding, and a background job ignores Ctrl-C: stop the process too.
  [ -n "$emulator_pid" ] || return 0
  kill "$emulator_pid" 2>/dev/null || true
  # Wait for it to let go of its port and AVD lock, so a rerun can start another.
  tries=0
  while kill -0 "$emulator_pid" 2>/dev/null && [ "$tries" -lt 20 ]; do
    sleep 0.5
    tries=$((tries + 1))
  done
  if kill -0 "$emulator_pid" 2>/dev/null; then kill -9 "$emulator_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Booting $AVD_NAME..."
emulator -avd "$AVD_NAME" -port "$EMULATOR_PORT" -no-window -no-audio \
  -no-snapshot -no-boot-anim >"$emulator_log" 2>&1 &
emulator_pid=$!
# Poll, each try bounded, rather than adb wait-for-device, which waits forever for an
# emulator that exited.
boot_deadline=$(($(date +%s) + BOOT_TIMEOUT))
until [ "$(bounded "$(boot_poll_limit)" adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    echo "Error: the emulator exited before it booted; see $emulator_log." >&2
    exit 1
  fi
  if [ "$(date +%s)" -ge "$boot_deadline" ]; then
    echo "Error: $AVD_NAME did not boot within $BOOT_TIMEOUT seconds; see $emulator_log." >&2
    exit 1
  fi
  sleep 2
done
booted=true

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
