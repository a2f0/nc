import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const helperPath = resolve(import.meta.dir, "../lib/store_listing.rb");

// Stages into a fresh output directory, returning the call's result or error.
const script = `
require "json"
require ARGV.fetch(0)

method, *args = JSON.parse(ARGV.fetch(1))
begin
  puts JSON.generate(result: StoreListing.public_send(method, *args))
rescue StandardError => e
  puts JSON.generate(error: e.message)
end
`;

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "store-listing-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function touch(...paths: string[]): Promise<void> {
  for (const path of paths) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), path);
  }
}

async function stage(method: string, ...args: string[]): Promise<{ result?: string; error?: string }> {
  const child = Bun.spawn(["ruby", "-e", script, helperPath, JSON.stringify([method, ...args])], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  return JSON.parse(stdout);
}

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(join(root, dir), { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(join(root, dir), join(entry.parentPath, entry.name)))
    .sort();
}

test("iOS screenshots go in one locale folder, prefixed by device", async () => {
  await touch("shots/ios/iphone/01-home.png", "shots/ios/iphone/02-playing.png", "shots/ios/ipad/01-home.png");
  await touch("shots/ios/iphone/notes.txt", "shots/ios/maestro/report.png");

  const staged = await stage("stage_ios_screenshots", join(root, "shots"), join(root, "out"));

  expect(staged).toEqual({ result: join(root, "out") });
  expect(await files("out")).toEqual(["en-US/ipad-01-home.png", "en-US/iphone-01-home.png", "en-US/iphone-02-playing.png"]);
});

test("Play listing copies the text and adds phone screenshots", async () => {
  await touch("metadata/en-US/title.txt", "metadata/en-US/full_description.txt");
  await touch("shots/android/phone/01-home.png", "shots/android/phone/02-playing.png", "shots/android/emulator.log");

  const staged = await stage("stage_play_listing", join(root, "metadata"), join(root, "shots"), join(root, "out"));

  expect(staged).toEqual({ result: join(root, "out/en-US/images") });
  expect(await files("out")).toEqual([
    "en-US/full_description.txt",
    "en-US/images/phoneScreenshots/01-home.png",
    "en-US/images/phoneScreenshots/02-playing.png",
    "en-US/title.txt",
  ]);
});

test("missing screenshots point at the screenshot script", async () => {
  await touch("shots/ios/iphone/01-home.png");

  const staged = await stage("stage_ios_screenshots", join(root, "shots"), join(root, "out"));

  expect(staged.error).toBe(`No screenshots in ${join(root, "shots/ios/ipad")}. Run scripts/takeScreenshots.sh first.`);
});
