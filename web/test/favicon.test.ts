import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { favicon } from "../build";

const ASSETS_DIR = join(import.meta.dir, "../../assets");

test("the favicon is the background and the mark's lit segments", async () => {
  const background = await readFile(join(ASSETS_DIR, "background.svg"), "utf8");
  const icon = await readFile(join(ASSETS_DIR, "icon.svg"), "utf8");
  const svg = favicon(background, icon);

  const rects = (source: string) => source.match(/<rect [^>]*\/>/g) ?? [];
  const unlit = icon.match(/<g id="unlit"[^>]*>([\s\S]*?)<\/g>/)?.[1] ?? "";
  expect(rects(unlit).length).toBeGreaterThan(0);
  // The corner clip, the background, and every lit segment; no unlit ones.
  expect(rects(svg).length).toBe(1 + rects(background).length + rects(icon).length - rects(unlit).length);
  expect(svg).not.toContain('id="unlit"');
  expect(svg).not.toContain("<?xml");
});

test("the favicon needs the mark's unlit group", () => {
  expect(() => favicon("<svg></svg>", "<svg><rect/></svg>")).toThrow("no unlit group");
});
