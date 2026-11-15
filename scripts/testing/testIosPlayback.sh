#!/bin/sh
set -eu

# Exercise NoisePlayer's real notification handlers and durable recovery marker
# in an isolated simulator. Never installs into a user's day-to-day simulator.
REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)"
device_type=com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro
# The newest iOS 18+ runtime that supports the device type: Xcode can install
# several runtimes of one version, such as iOS 27.2's general runtime and one
# for a single new device type, listed in no useful order.
runtime=$(xcrun simctl list runtimes available -j | DEVICE_TYPE="$device_type" bun -e '
  const type = process.env.DEVICE_TYPE;
  const data = await Bun.stdin.json();
  const runtimes = data.runtimes.filter(r => r.isAvailable && r.identifier.includes(".iOS-") &&
    Number(r.version.split(".")[0]) >= 18 && (r.supportedDeviceTypes ?? []).some(t => t.identifier === type));
  runtimes.sort((a, b) => b.version.localeCompare(a.version, undefined, {numeric: true}));
  if (!runtimes.length) {
    console.error("Error: no available iOS 18 or later simulator runtime supports " + type + ".");
    process.exit(1);
  }
  console.log(runtimes[0].identifier);
')
udid=$(xcrun simctl create 'Noise Connoisseur Playback Tests' "$device_type" "$runtime")
cleanup() {
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  xcrun simctl delete "$udid" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
xcodebuild -quiet -project "$REPO_ROOT/ios/NoiseConnoisseur.xcodeproj" -scheme NoiseConnoisseur \
  -destination "platform=iOS Simulator,id=$udid" -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
