import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../..");
let output = "";

beforeEach(() => {
  output = mkdtempSync(join(tmpdir(), "nc-screenshots-"));
});

afterEach(() => {
  rmSync(output, { recursive: true, force: true });
});

// Runs the capture with no Maestro on PATH, so a capture that gets past the
// shared-capture check stops at its first prerequisite instead of capturing.
function capture(platform: string, target = output): { status: number | null; stderr: string } {
  const result = spawnSync("sh", [join(root, "scripts/testing/takeScreenshots.sh"), platform], {
    encoding: "utf8",
    env: { HOME: output, PATH: "/usr/bin:/bin", SCREENSHOT_OUTPUT_DIR: target },
  });
  return { status: result.status, stderr: result.stderr };
}

function record(status: string): void {
  const record = { schemaVersion: 1, status, commit: "0".repeat(40), dirty: false, args: [] };
  writeFileSync(join(output, "capture.json"), `${JSON.stringify(record, null, 2)}\n`);
}

test("capture takes at most one platform", () => {
  const result = spawnSync("sh", [join(root, "scripts/testing/takeScreenshots.sh"), "ios", "android"], { encoding: "utf8" });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("Usage:");
});

test.each(["ios", "android"])("%s capture refuses to overwrite a recorded shared capture", (platform) => {
  for (const status of ["complete", "failed"]) {
    record(status);
    const result = capture(platform);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${output} holds shared screenshots`);
    expect(result.stderr).not.toContain("maestro is required");
  }
});

test.each(["ios", "android"])("%s capture runs under a running record or without one", (platform) => {
  for (const setup of [() => record("running"), () => rmSync(join(output, "capture.json"), { force: true })]) {
    setup();
    const result = capture(platform);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Error: maestro is required.");
  }
});

test.each(["ios", "android"])("%s capture refuses a linked store without a running record", (platform) => {
  const store = join(output, "store");
  const link = join(output, "link");
  mkdirSync(store);
  symlinkSync(store, link);
  const refused = capture(platform, link);
  expect(refused.status).toBe(1);
  expect(refused.stderr).toContain(`${link} holds shared screenshots`);
  writeFileSync(join(store, "capture.json"), '{\n  "status": "running"\n}\n');
  expect(capture(platform, link).stderr).toContain("Error: maestro is required.");
});

// The Android capture in a copy of its tree, with stand-ins for the build, the SDK, and
// Maestro. The emulator stand-in either exits at once or never boots. adb either finds no
// device and, like the real one, waits forever for one, or hangs on every shell command, as
// it can on an emulator that has stopped responding.
function fakeAndroidCapture(emulator: "exits" | "never-boots", adb: "no-device" | "hangs" = "no-device") {
  const repo = join(output, "repo");
  const sdk = join(output, "sdk");
  const bin = join(output, "bin");
  const pidFile = join(output, "emulator.pid");
  const script = (path: string, body: string) => {
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  };
  mkdirSync(join(repo, "scripts/testing/lib"), { recursive: true });
  for (const file of ["takeAndroidScreenshots.sh", "lib/screenshots.sh"]) {
    copyFileSync(join(root, "scripts/testing", file), join(repo, "scripts/testing", file));
  }
  script(join(repo, "scripts/dev/ensureGradleWrapper.sh"), ":");
  script(join(repo, "android/gradlew"), ":");
  script(join(sdk, "emulator/emulator"), `[ "$1" = -list-avds ] && { echo NoiseConnoisseur_Screenshots; exit 0; }
${emulator === "exits" ? "exit 1" : `echo $$ >"${pidFile}"; exec sleep 300`}`);
  script(join(sdk, "platform-tools/adb"), `[ "$3" = wait-for-device ] && exec sleep 300
${adb === "hangs" ? "exec sleep 300" : `echo "adb: device '$2' not found" >&2; exit 1`}`);
  script(join(sdk, "cmdline-tools/latest/bin/avdmanager"), "exit 1");
  for (const tool of ["maestro", "magick"]) script(join(bin, tool), "exit 1");
  // Its own process group, so the test can stop everything the capture left behind.
  const child = spawn("sh", [join(repo, "scripts/testing/takeAndroidScreenshots.sh")], {
    detached: true,
    env: {
      HOME: output, PATH: `${bin}:/usr/bin:/bin`, ANDROID_HOME: sdk,
      SCREENSHOT_OUTPUT_DIR: join(output, "screenshots"), ANDROID_SCREENSHOT_BOOT_TIMEOUT: "3",
    },
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const exited = new Promise<number | null>((done) => child.on("exit", (code, signal) => done(code ?? (signal ? -1 : null))));
  const within = (ms: number) => Promise.race([exited, Bun.sleep(ms).then(() => "still running" as const)]);
  const emulatorPid = () => existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : null;
  const alive = (pid: number | null) => {
    if (pid === null) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  const stop = () => {
    for (const target of [-child.pid!, emulatorPid()]) {
      try { if (target) process.kill(target, "SIGKILL"); } catch { /* already gone */ }
    }
  };
  return { child, within, stderr: () => stderr, emulatorPid, alive, stop };
}

test("android capture fails, rather than waiting forever, when the emulator exits", async () => {
  const capture = fakeAndroidCapture("exits");
  try {
    expect(await capture.within(15_000)).toBe(1);
    expect(capture.stderr()).toContain("the emulator exited before it booted");
  } finally { capture.stop(); }
}, 20_000);

test.each(["no-device", "hangs"] as const)("android capture stops its emulator when it never boots (adb %s)", async (adb) => {
  const capture = fakeAndroidCapture("never-boots", adb);
  try {
    expect(await capture.within(15_000)).toBe(1);
    expect(capture.stderr()).toContain("did not boot within 3 seconds");
    expect(capture.alive(capture.emulatorPid())).toBe(false);
  } finally { capture.stop(); }
}, 20_000);

test("android capture stops its emulator when interrupted while it boots", async () => {
  const capture = fakeAndroidCapture("never-boots");
  try {
    for (let tries = 0; capture.emulatorPid() === null && tries < 100; tries++) await Bun.sleep(50);
    expect(capture.alive(capture.emulatorPid())).toBe(true);
    capture.child.kill("SIGINT");
    expect(await capture.within(10_000)).toBe(130);
    expect(capture.alive(capture.emulatorPid())).toBe(false);
  } finally { capture.stop(); }
}, 20_000);
