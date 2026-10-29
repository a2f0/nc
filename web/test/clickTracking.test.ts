import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { type Browser, chromium } from "playwright";
import { build } from "../build";

const origin = "https://nc.a2f0.net";
const endpoint = "https://ct.a2f0.net/v1/clicks";
const root = mkdtempSync(join(tmpdir(), "nc-clicks-"));
const output = join(root, "production");
const preview = join(root, "preview");
let browser: Browser;

beforeAll(async () => {
  await build(output, true);
  await build(preview);
  browser = await chromium.launch();
}, 30_000);
afterAll(async () => {
  await browser?.close();
  rmSync(root, { recursive: true, force: true });
});

type Privacy = "none" | "gpc" | "dnt" | "extension" | "saved" | "automation";
interface Batch {
  site: string;
  environment: string;
  events: { app: string; page: string; target: string; label: string | null }[];
}

async function openSite(
  privacy: Privacy = "none",
  site = origin,
  directory = output,
) {
  const context = await browser.newContext();
  const batches: Batch[] = [];
  await context.addInitScript((setting: Privacy) => {
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get: () => setting === "automation",
    });
    Object.defineProperty(Navigator.prototype, "globalPrivacyControl", {
      get: () => setting !== "none",
    });
    Object.defineProperty(Navigator.prototype, "doNotTrack", {
      get: () => (setting === "dnt" ? "1" : null),
    });
    if (setting === "saved") localStorage.setItem("ct:opt-out", "1");
  }, privacy);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.url() === endpoint) {
      expect(request.headers()["referer"]).toBeUndefined();
      batches.push(request.postDataJSON() as Batch);
      await route.fulfill({
        status: 204,
        headers: { "Access-Control-Allow-Origin": site },
      });
      return;
    }
    if (url.origin !== site) {
      await route.abort();
      return;
    }
    const name = url.pathname === "/" ? "index.html" :
      extname(url.pathname) === "" ? `${url.pathname}.html` : url.pathname;
    const file = Bun.file(join(directory, name));
    if (!(await file.exists())) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({
      body:
        url.pathname === "/" && privacy === "extension"
          ? (await file.text()).replace(
              '<html lang="en">',
              '<html lang="en" data-ct-disabled>',
            )
          : Buffer.from(await file.arrayBuffer()),
      contentType: file.type,
    });
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(`${site}/?private=secret#sensitive`, { waitUntil: "load" });
  return { context, page, batches };
}

type Site = Awaited<ReturnType<typeof openSite>>;

/** Ends the visit and waits for the batch its clicks send. */
async function flush(page: Site["page"]) {
  const sent = page.waitForResponse(endpoint);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await sent;
}

/** Ends the visit, outlasts every flush timer, and checks that nothing was sent. */
async function expectNothingSent(page: Site["page"], batches: Site["batches"]) {
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.clock.runFor(6_000);
  await page.waitForTimeout(200);
  expect(batches).toEqual([]);
}

test("trusted clicks flush with website attribution and GPC override", async () => {
  const { context, page, batches } = await openSite("gpc");
  try {
    await page.locator("#more").click();
    await flush(page);
    expect(batches).toHaveLength(1);
    expect(Object.keys(batches[0] ?? {}).sort()).toEqual(["environment", "events", "site"]);
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })))
      .toEqual({ local: [], session: [] });
    expect(batches[0]).toMatchObject({
      site: "nc",
      environment: "production",
      events: [{ app: "web-app", page: "/", target: "button", label: null }],
    });
    const serialized = JSON.stringify(batches);
    for (const privateValue of [
      "secret",
      "sensitive",
      "Noise Connoisseur",
      "private",
      "href",
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  } finally {
    await context.close();
  }
}, 15_000);

test("links and controls omit sound names, text, values, and destinations", async () => {
  const { context, page, batches } = await openSite("gpc");
  try {
    await page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault()));
    await page.locator("#support").click();
    await page.locator("#more").click();
    await page.locator("#volume").click();
    await flush(page);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.events).toHaveLength(2);
    expect(batches[0]?.events.map((event) => event.target)).toEqual(["a", "button"]);
    for (const event of batches[0]?.events ?? []) {
      expect(event).toMatchObject({ app: "web-app", page: "/", label: null });
      expect(Object.keys(event).sort()).toEqual(["app", "id", "label", "page", "target", "timestamp"]);
    }
    for (const value of ["support", "volume", "White Noise", "Noise Connoisseur", "secret", "sensitive", "href"]) {
      expect(JSON.stringify(batches)).not.toContain(value);
    }
  } finally { await context.close(); }
}, 15_000);

test("sound cards, playback controls, and history omit sound identity", async () => {
  const { context, page, batches } = await openSite("gpc");
  try {
    await page.locator("#sounds .card").first().click();
    await page.locator("#playback").click();
    await page.locator("#more").click();
    await page.locator("#open-history").click();
    await page.locator(".history-legend button").first().click();
    await flush(page);
    expect(batches).toHaveLength(1);
    expect(Object.keys(batches[0] ?? {}).sort()).toEqual(["environment", "events", "site"]);
    expect(batches[0]?.events).toHaveLength(5);
    for (const event of batches[0]?.events ?? []) {
      expect(event).toMatchObject({ app: "web-app", page: "/", target: "button", label: null });
      expect(Object.keys(event).sort()).toEqual(["app", "id", "label", "page", "target", "timestamp"]);
    }
    for (const value of ["white", "pink", "brown", "waves", "fan", "playback", "history", "soundId", "minutes"]) {
      expect(JSON.stringify(batches)).not.toContain(value);
    }
  } finally { await context.close(); }
}, 15_000);

for (const privacy of ["dnt", "extension", "saved", "automation"] as const) {
  test(`${privacy} prevents collection despite the GPC override`, async () => {
    const { context, page, batches } = await openSite(privacy);
    try {
      await page.locator("#more").click();
      await expectNothingSent(page, batches);
    } finally {
      await context.close();
    }
  }, 15_000);
}

test("the extension clears clicks queued before opting out", async () => {
  const { context, page, batches } = await openSite();
  try {
    await page.locator("#more").click();
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-ct-disabled", "");
      document.dispatchEvent(new Event("ct:opt-out-change"));
      window.dispatchEvent(new Event("pagehide"));
    });
    await page.clock.runFor(6_000);
    await page.waitForTimeout(200);
    expect(batches).toEqual([]);
  } finally {
    await context.close();
  }
}, 15_000);

for (const site of ["http://localhost:8787", "https://preview.example.com"]) {
  test(`the production bundle stays inert at ${site}`, async () => {
    const { context, page, batches } = await openSite("none", site);
    try {
      await page.locator("#more").click();
      await expectNothingSent(page, batches);
    } finally {
      await context.close();
    }
  }, 15_000);
}

test("default preview builds are inert even on the production host", async () => {
  const { context, page, batches } = await openSite("none", origin, preview);
  try {
    await page.locator("#more").click();
    await expectNothingSent(page, batches);
  } finally {
    await context.close();
  }
}, 15_000);

for (const path of ["/privacy", "/support"]) {
  test(`production text page ${path} also records safe clicks`, async () => {
    const { context, page, batches } = await openSite("gpc");
    try {
      await page.goto(origin + path + "?private=secret#sensitive", { waitUntil: "load" });
      await page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault()));
      await page.locator("footer a").first().click();
      await flush(page);
      expect(batches).toHaveLength(1);
      expect(batches[0]?.events).toMatchObject([{ app: "web-app", page: "/", target: "a", label: null }]);
    } finally { await context.close(); }
  }, 15_000);
}

for (const path of ["/ios/privacy", "/ios/support", "/android/privacy", "/android/support"]) {
  test(`native app page ${path} never loads the tracker`, async () => {
    const { context, page, batches } = await openSite("gpc");
    try {
      const loaded: Record<string, number> = {};
      page.on("response", (response) => { loaded[new URL(response.url()).pathname] = response.status(); });
      await page.goto(origin + path, { waitUntil: "load" });
      expect(loaded).toMatchObject({ [path]: 200, "/appearance-init.js": 200, "/styles.css": 200 });
      expect(Object.keys(loaded)).not.toContain("/clickTracking.js");
      await page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault()));
      await page.locator("footer a").first().click();
      await expectNothingSent(page, batches);
    } finally { await context.close(); }
  }, 15_000);
}

test("importing the bootstrap cannot initialize tracking", async () => {
  const script = `
    for (const name of ["window", "document", "navigator", "localStorage", "fetch"]) {
      Object.defineProperty(globalThis, name, { get() { throw new Error("Unexpected browser access: " + name); } });
    }
    await import(${JSON.stringify(join(import.meta.dir, "../src/clickTracking.ts"))});
  `;
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect({ stdout, stderr, code }).toEqual({ stdout: "", stderr: "", code: 0 });
});
