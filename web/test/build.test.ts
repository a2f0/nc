import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../build";

const BRAND_DIR = join(import.meta.dir, "../../assets/brand");
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nc-web-build-"));
  await build(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("the About sheet shows the root package's version", async () => {
  const { version } = (await Bun.file(join(import.meta.dir, "../../package.json")).json()) as { version: string };
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  const script = await readFile(join(dir, "main.js"), "utf8");
  expect(script).toContain(JSON.stringify(version));
  // Defined away, rather than left as a global the page doesn't have.
  expect(script).not.toContain("APP_VERSION");
  expect(await readFile(join(dir, "index.html"), "utf8")).toContain('<p id="version"');
});

test("every page's favicon is the app icon without the mark's unlit segments", async () => {
  const svg = await readFile(join(dir, "icon.svg"), "utf8");
  const logo = await readFile(join(BRAND_DIR, "logo.svg"), "utf8");
  const background = await readFile(join(BRAND_DIR, "background.svg"), "utf8");

  const rects = (source: string): string[] => source.match(/<rect [^>]*\/>/g) ?? [];
  const unlit = rects(logo.match(/<g id="unlit"[^>]*>([\s\S]*?)<\/g>/)?.[1] ?? "");
  expect(unlit.length).toBeGreaterThan(0);
  // The background and every lit segment; no unlit ones.
  for (const rect of [...rects(background), ...rects(logo)]) {
    expect({ rect, drawn: svg.includes(rect) }).toEqual({ rect, drawn: !unlit.includes(rect) });
  }
  // Rounded like the app icon: 224 of 1024.
  expect(svg).toContain('rx="224"');

  for (const page of ["index.html", "privacy.html", "support.html"]) {
    expect(await readFile(join(dir, page), "utf8")).toContain('<link rel="icon" href="icon.svg" type="image/svg+xml" />');
  }
});
