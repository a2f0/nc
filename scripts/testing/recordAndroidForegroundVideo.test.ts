import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dir, "../..");
// The image the recorder builds its AVD on unless ANDROID_EVIDENCE_SYSTEM_IMAGE says otherwise.
const evidenceImage = "system-images;android-37.0;google_apis_playstore;arm64-v8a";
const api35Image = "system-images;android-35;google_apis_playstore;arm64-v8a";
let output = "";

beforeEach(() => {
  output = mkdtempSync(join(tmpdir(), "nc-evidence-"));
});

afterEach(() => {
  rmSync(output, { recursive: true, force: true });
});

// The recorder in a clean copy of its tree, with a stand-in release AAB and its build receipt,
// and stand-ins for the SDK and tools; java fails, so the run stops at bundletool's first
// command, after the recorder has dealt with its AVD. The AVD exists, built on avdImage. adb
// lists emulator-5590 when listed is given: in that state, running that AVD, or not answering
// which when its avd is null. The avdmanager stand-in records its arguments.
function record({ avdImage = evidenceImage, listed }: {
  avdImage?: string;
  listed?: { state: "device" | "offline"; avd: string | null };
} = {}) {
  const repo = join(output, "repo");
  const bin = join(output, "bin");
  const home = join(output, "home");
  const avdmanagerArgs = join(output, "avdmanager.args");
  const file = (path: string, body: string, mode = 0o644) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    chmodSync(path, mode);
  };
  for (const path of ["scripts/testing/recordAndroidForegroundVideo.rb", "fastlane/lib/play_evidence.rb", "fastlane/lib/readiness.rb"]) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    copyFileSync(join(root, path), join(repo, path));
  }
  // The App Bundle's inputs, which its receipt must still match.
  for (const path of ["android/build.gradle.kts", "assets/brand/logo.svg", "agent-tool.json", ".mise.toml", "scripts/dev/ensureGradleWrapper.sh"]) {
    file(join(repo, path), "\n");
  }
  file(join(repo, ".gitignore"), ".store-evidence/\n");
  const git = (...args: string[]) => spawnSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-q", "--no-verify", "-m", "test");
  const commit = git("rev-parse", "HEAD").stdout.trim();
  const aab = join(output, "app-release.aab");
  file(aab, "aab");
  const sha256 = createHash("sha256").update("aab").digest("hex");
  file(`${aab}.build.json`, JSON.stringify({ schema_version: 1, sha256, source: { commit, dirty: false } }));
  file(join(output, "bundletool.jar"), "");

  const avdDir = join(home, ".android/avd/NoiseConnoisseur_Evidence.avd");
  file(join(home, ".android/avd/NoiseConnoisseur_Evidence.ini"), `avd.ini.encoding=UTF-8\npath=${avdDir}\n`);
  file(join(avdDir, "config.ini"), `hw.lcd.density=420\nimage.sysdir.1=${avdImage.replaceAll(";", "/")}/\n`);

  const script = (name: string, body: string) => file(join(bin, name), `#!/bin/sh\n${body}\n`, 0o755);
  script("emulator", `[ "$1" = -list-avds ] && { echo NoiseConnoisseur_Evidence; exit 0; }\nexit 1`);
  const avdName = listed?.avd === null ? `echo "error: could not connect" >&2; exit 1` : `echo ${listed?.avd}; echo OK; exit 0`;
  script("adb", `[ "$1" = devices ] && { echo "List of devices attached"; ${listed ? `printf 'emulator-5590\\t${listed.state}\\n'; ` : ""}exit 0; }
[ "$3" = emu ] && { ${avdName}; }
exit 1`);
  script("avdmanager", `echo "$@" >"${avdmanagerArgs}"`);
  for (const tool of ["maestro", "scrcpy", "ffmpeg", "ffprobe", "java", "unzip"]) script(tool, "exit 1");

  const result = spawnSync("ruby", [join(repo, "scripts/testing/recordAndroidForegroundVideo.rb"), aab, join(output, "bundletool.jar")], {
    encoding: "utf8",
    env: { HOME: home, PATH: `${bin}:${dirname(Bun.which("ruby")!)}:/usr/bin:/bin`, ANDROID_HOME: join(output, "sdk") },
  });
  const avdmanager = existsSync(avdmanagerArgs) ? readFileSync(avdmanagerArgs, "utf8").trim() : null;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, avdmanager };
}

test("evidence recorder reuses its AVD on the recording image", () => {
  const result = record();
  expect(result.stderr).toContain("java failed");
  expect(result.avdmanager).toBeNull();
});

test.each([undefined, { state: "offline", avd: "Pixel_9_API_37" }] as const)(
  "evidence recorder recreates its AVD built on another image (listed emulator %o)",
  (listed) => {
    const result = record({ avdImage: api35Image, listed });
    expect(result.stdout).toContain("it was on system-images/android-35/google_apis_playstore/arm64-v8a");
    expect(result.stderr).toContain("java failed");
    expect(result.avdmanager).toBe(
      `--silent create avd --name NoiseConnoisseur_Evidence --package ${evidenceImage} --device pixel_2 --force`,
    );
  },
);

test.each([
  [{ state: "offline", avd: "NoiseConnoisseur_Evidence" }, "NoiseConnoisseur_Evidence is already running"],
  [{ state: "device", avd: null }, "emulator-5590 didn't say which AVD it runs"],
  [{ state: "offline", avd: null }, "emulator-5590 didn't say which AVD it runs"],
] as const)("evidence recorder leaves an AVD that may be running (listed emulator %o)", (listed, error) => {
  const result = record({ avdImage: api35Image, listed });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(error);
  expect(result.avdmanager).toBeNull();
});
