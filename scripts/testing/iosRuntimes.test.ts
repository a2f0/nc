import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Simulator runtime selection in the iOS screenshot capture and playback test, run
// against stand-ins for xcrun and the tools around it.

const root = resolve(import.meta.dir, "../..");
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nc-ios-runtimes-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const deviceType = (name: string) => `com.apple.CoreSimulator.SimDeviceType.${name}`;
const runtimeId = (name: string) => `com.apple.CoreSimulator.SimRuntime.${name}`;
const runtime = (name: string, version: string, types: string[]) => ({
  identifier: runtimeId(name),
  version,
  isAvailable: true,
  platform: "iOS",
  supportedDeviceTypes: types.map((type) => ({ identifier: deviceType(type), name: type })),
});
const allTypes = ["iPhone-16-Pro", "iPhone-16-Pro-Max", "iPad-Pro-13-inch-M4-8GB"];
// Xcode 27.2 lists a runtime for one new device type before the general runtime of the
// same version.
const duo = runtime("iOS-27-2-iPhone19-4", "27.2", ["iPhone-Duo"]);
const ios26 = runtime("iOS-26-2", "26.2", allTypes);
const ios27 = runtime("iOS-27-2", "27.2", allTypes);

// Runs a script with stand-ins for xcrun, which lists the given runtimes and records
// every other call, and for xcodebuild, Maestro, and ImageMagick. Maestro fails, so a
// screenshot capture stops at its first device.
function run(script: string, runtimes: object[], env: Record<string, string> = {}) {
  const bin = join(dir, "bin");
  const log = join(dir, "calls.log");
  const fixture = join(dir, "runtimes.json");
  mkdirSync(bin);
  writeFileSync(fixture, JSON.stringify({ runtimes }));
  const stub = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  const record = `(IFS='\t'; printf '%s\\n' "$*") >>"${log}"`;
  stub("xcrun", `case "$1 $2 $3" in
  "simctl list runtimes") cat "${fixture}" ;;
  "simctl list devices") echo '{"devices":{}}' ;;
  "simctl create "*) ${record}; echo FAKE-UDID ;;
  *) ${record} ;;
esac`);
  stub("xcodebuild", `set -- xcodebuild "$@"; ${record}`);
  stub("maestro", "exit 1");
  stub("magick", ":");
  const jq = Bun.which("jq");
  if (jq) symlinkSync(jq, join(bin, "jq"));
  const result = spawnSync("sh", [join(root, "scripts/testing", script)], {
    encoding: "utf8",
    env: {
      HOME: dir, TMPDIR: dir, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      SCREENSHOT_OUTPUT_DIR: join(dir, "screenshots"), ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trimEnd().split("\n").map((line) => line.split("\t")) : [];
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
}

const creates = (calls: string[][]) => calls.filter((call) => call[0] === "simctl" && call[1] === "create");

test.each([
  [{}, ios27.identifier],
  [{ IOS_SCREENSHOT_RUNTIME_VERSION: "26.2" }, ios26.identifier],
])("screenshot capture skips a same-version runtime that lacks its device (%o)", (env, expected) => {
  const result = run("takeIosScreenshots.sh", [duo, ios26, ios27], env);
  expect(creates(result.calls)).toEqual([
    ["simctl", "create", "Noise Connoisseur Screenshots (iphone)", deviceType("iPhone-16-Pro-Max"), expected],
  ]);
  expect(result.stdout).toContain(`Capturing iphone on FAKE-UDID (${expected})...`);
});

test.each([
  ["iPhone-16-Pro-Max", [duo]],
  ["iPad-Pro-13-inch-M4-8GB", [duo, runtime("iOS-27-2", "27.2", ["iPhone-16-Pro-Max"])]],
])("screenshot capture fails before building when no runtime supports %s", (type, runtimes) => {
  const result = run("takeIosScreenshots.sh", runtimes);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`no installed iOS 27.2 simulator runtime supports ${deviceType(type)}.`);
  expect(result.calls).toEqual([]);
});

test("playback test takes the newest runtime that supports its device", () => {
  const result = run("testIosPlayback.sh", [duo, ios26, ios27]);
  expect(result.status).toBe(0);
  expect(creates(result.calls)).toEqual([
    ["simctl", "create", "Noise Connoisseur Playback Tests", deviceType("iPhone-16-Pro"), ios27.identifier],
  ]);
  expect(result.calls.at(-1)).toEqual(["simctl", "delete", "FAKE-UDID"]);
});

test("playback test fails when no runtime supports its device", () => {
  const result = run("testIosPlayback.sh", [duo]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`no available iOS 18 or later simulator runtime supports ${deviceType("iPhone-16-Pro")}.`);
  expect(result.calls).toEqual([]);
});
