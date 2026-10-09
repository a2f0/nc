import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../build";

test("the About sheet shows the root package's version", async () => {
  const { version } = (await Bun.file(join(import.meta.dir, "../../package.json")).json()) as { version: string };
  expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  const dir = await mkdtemp(join(tmpdir(), "nc-web-build-"));
  try {
    await build(dir);
    const script = await readFile(join(dir, "main.js"), "utf8");
    expect(script).toContain(JSON.stringify(version));
    // Defined away, rather than left as a global the page doesn't have.
    expect(script).not.toContain("APP_VERSION");
    expect(await readFile(join(dir, "index.html"), "utf8")).toContain('<p id="version"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
