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

  expect(staged.error).toBe(`No screenshots in ${join(root, "shots/ios/ipad")}. Run bun run screenshots first.`);
});

// Runs the capture guard around a copy that stages a marker file and, when
// given, rewrites capture.json the way an overlapping capture would.
const guardScript = `
require "json"
require ARGV.fetch(0)

shots, output, rewrite = ARGV.drop(1)
messages = []
begin
  result = StoreListing.with_shared_capture(shots, announce: ->(line) { messages << line }) do
    File.write(File.join(output, "copied"), "")
    File.write(File.join(shots, "capture.json"), rewrite) if rewrite
    :copied
  end
  puts JSON.generate(result: result, messages: messages)
rescue StandardError => e
  puts JSON.generate(error: e.message, messages: messages)
end
`;

const complete = {
  status: "complete",
  commit: "0123456789abcdef0123456789abcdef01234567",
  dirty: false,
  args: [],
  finishedAt: "2026-10-30T12:00:00.000Z",
};

async function guard(record?: object | string, rewrite?: object): Promise<{ result?: string; error?: string; messages: string[]; copied: boolean }> {
  await rm(join(root, "shots"), { recursive: true, force: true });
  await rm(join(root, "out"), { recursive: true, force: true });
  await mkdir(join(root, "shots"), { recursive: true });
  await mkdir(join(root, "out"), { recursive: true });
  if (record !== undefined) {
    await writeFile(join(root, "shots/capture.json"), typeof record === "string" ? record : JSON.stringify(record));
  }
  const args = [helperPath, join(root, "shots"), join(root, "out"), ...(rewrite ? [JSON.stringify(rewrite)] : [])];
  const child = Bun.spawn(["ruby", "-e", guardScript, ...args], { stderr: "pipe", stdout: "pipe" });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  const copied = (await readdir(join(root, "out"))).includes("copied");
  return { ...JSON.parse(stdout), copied };
}

test("a complete shared capture is copied and named by its commit", async () => {
  expect(await guard(complete)).toEqual({
    result: "copied",
    messages: ["Screenshots from 0123456789, captured 2026-10-30T12:00:00.000Z."],
    copied: true,
  });
  expect((await guard({ ...complete, args: ["ios"] })).messages).toEqual([
    "Screenshots from 0123456789, captured 2026-10-30T12:00:00.000Z (partial: ios).",
  ]);
});

test("without a capture record the screenshots are copied as they are", async () => {
  expect(await guard()).toEqual({ result: "copied", messages: [], copied: true });
});

test.each(["running", "failed"])("a %s shared capture is refused before copying", async (status) => {
  const { finishedAt: _finishedAt, ...started } = complete;
  expect(await guard({ ...started, status })).toEqual({
    error: `The shared screenshot capture is ${status}; wait for it or recapture.`,
    messages: [],
    copied: false,
  });
});

test("a capture of uncommitted changes is refused before copying", async () => {
  expect(await guard({ ...complete, dirty: true })).toEqual({
    error: "The shared screenshots were captured from uncommitted changes; recapture from a commit.",
    messages: [],
    copied: false,
  });
});

test("a capture that starts while copying fails the upload", async () => {
  const { finishedAt: _finishedAt, ...started } = complete;
  const changed = await guard(complete, { ...started, status: "running" });
  expect(changed.error).toBe("A screenshot capture started while copying the screenshots; upload again once it finishes.");
  expect(changed.copied).toBe(true);
  // A capture into a clone that had no record also counts.
  expect((await guard(undefined, { ...started, status: "running" })).error).toBe(changed.error);
});
