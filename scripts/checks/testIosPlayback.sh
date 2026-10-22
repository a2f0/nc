#!/bin/sh
set -eu

# Exercise NoisePlayer's real notification handlers and durable recovery marker
# in an isolated simulator. Never installs into a user's day-to-day simulator.
REPO_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)"
runtime=$(xcrun simctl list runtimes available -j | bun -e '
  const data = await Bun.stdin.json();
  const runtimes = data.runtimes.filter(r => r.isAvailable && r.identifier.includes(".iOS-") && Number(r.version.split(".")[0]) >= 18);
  runtimes.sort((a, b) => b.version.localeCompare(a.version, undefined, {numeric: true}));
  if (!runtimes.length) process.exit(1);
  console.log(runtimes[0].identifier);
')
udid=$(xcrun simctl create 'Noise Connoisseur Playback Tests' com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro "$runtime")
cleanup() {
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  xcrun simctl delete "$udid" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
xcodebuild -quiet -project "$REPO_ROOT/ios/NoiseConnoisseur.xcodeproj" -scheme NoiseConnoisseur \
  -destination "platform=iOS Simulator,id=$udid" -parallel-testing-enabled NO \
  CODE_SIGNING_ALLOWED=NO test
