import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const iosMetadata = resolve(import.meta.dir, "../metadata/ios");
const notesPath = join(iosMetadata, "review_information/notes.txt");

// App Review's answer to a Guideline 2.1 "Information Needed" request lists what the notes
// must cover; `ios listing` uploads this file to the App Review Information notes.
const REQUIRED_SECTIONS = [
  "SCREEN RECORDING",
  "PURPOSE AND AUDIENCE",
  "HOW TO USE IT",
  "EXTERNAL SERVICES",
  "REGIONAL DIFFERENCES",
  "REGULATED INDUSTRIES AND THIRD-PARTY MATERIAL",
];

test("review notes answer each App Review information request", async () => {
  const notes = await readFile(notesPath, "utf8");
  const headings = notes.split("\n").filter((line) => /^[A-Z][A-Z -]+$/.test(line));
  expect(headings).toEqual(REQUIRED_SECTIONS);
  // App Store Connect's limit for the notes field.
  expect(notes.length).toBeLessThanOrEqual(4000);
});

// Guideline 2.3.10: no other mobile platforms in the iOS app's metadata.
test("iOS metadata does not name other mobile platforms", async () => {
  const files = await readdir(iosMetadata, { recursive: true, withFileTypes: true });
  for (const file of files.filter((entry) => entry.isFile())) {
    const path = join(file.parentPath, file.name);
    expect({ path, text: await readFile(path, "utf8") }).not.toEqual(
      expect.objectContaining({ text: expect.stringMatching(/android|google play/i) }),
    );
  }
});
