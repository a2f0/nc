import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, canonicalUrl, NOT_FOUND_PAGE, PAGES } from "../build";

// The built site served by Wrangler's local Workers runtime with web/wrangler.jsonc, so
// static-asset routing, not_found_handling, and the Worker behave as in production;
// web:dev only imitates them.
const WEB_DIR = join(import.meta.dir, "..");
const WRANGLER = join(WEB_DIR, "../node_modules/.bin/wrangler");
let dir: string;
let site: string;
let wrangler: ReturnType<typeof Bun.spawn> | undefined;
let origin: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nc-web-routing-"));
  site = join(dir, "site");
  await build(site);
  const log = join(dir, "wrangler.log");
  const errors = join(dir, "wrangler.err");
  const output = async () => (await Promise.all([log, errors].map(file => readFile(file, "utf8").catch(() => "")))).join("");
  wrangler = Bun.spawn([
    WRANGLER, "dev", "--config", join(WEB_DIR, "wrangler.jsonc"), "--local", "--assets", site,
    "--persist-to", join(dir, "state"), "--ip", "127.0.0.1", "--port", "0", "--inspector-port", "0",
    "--show-interactive-dev-session=false",
  ], { stdout: Bun.file(log), stderr: Bun.file(errors), env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  for (const started = Date.now(); Date.now() - started < 45_000; await Bun.sleep(100)) {
    const ready = /Ready on (http:\/\/127\.0\.0\.1:\d+)/.exec(await readFile(log, "utf8").catch(() => ""))?.[1];
    if (ready) {
      origin = ready;
      return;
    }
    if (wrangler.exitCode !== null) throw new Error(`wrangler dev exited (${wrangler.exitCode}):\n${await output()}`);
  }
  throw new Error(`wrangler dev wasn't ready:\n${await output()}`);
}, 60_000);

afterAll(async () => {
  wrangler?.kill();
  await wrangler?.exited;
  await rm(dir, { recursive: true, force: true });
});

const get = (path: string) => fetch(origin + path, { redirect: "manual" });

test("every page answers 200 at its canonical path, and its .html form redirects there", async () => {
  for (const page of PAGES) {
    const path = new URL(canonicalUrl(page)).pathname;
    const response = await get(path);
    expect({ path, status: response.status }).toEqual({ path, status: 200 });
    expect(await response.text()).toBe(await readFile(join(site, page), "utf8"));
    const html = await get(`/${page}`);
    expect({ page, status: html.status, location: html.headers.get("Location") })
      .toEqual({ page, status: 307, location: path });
  }
  const files = [["/robots.txt", "text/plain"], ["/sitemap.xml", "application/xml"], ["/og-image.png", "image/png"]] as const;
  for (const [path, type] of files) {
    const response = await get(path);
    expect({ path, status: response.status, type: response.headers.get("Content-Type")?.split(";")[0] })
      .toEqual({ path, status: 200, type });
  }
}, 15_000);

test("a missing path at any depth gets the not-found page with status 404", async () => {
  const notFound = await readFile(join(site, NOT_FOUND_PAGE), "utf8");
  for (const path of ["/missing", "/ios/missing", "/android/missing/deeper", "/ios/", "/missing.png"]) {
    const response = await get(path);
    expect({ path, status: response.status, type: response.headers.get("Content-Type"), same: await response.text() === notFound })
      .toEqual({ path, status: 404, type: "text/html; charset=utf-8", same: true });
  }
  // The Worker still answers /review/ itself.
  const review = await get("/review/missing");
  expect({ status: review.status, robots: review.headers.get("X-Robots-Tag"), body: await review.text() })
    .toEqual({ status: 404, robots: "noindex", body: "" });
}, 15_000);
