import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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
