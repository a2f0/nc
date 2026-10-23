import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { build, canonicalUrl, PAGES, SITE_URL, withMetadata } from "../build";

const BRAND_DIR = join(import.meta.dir, "../../assets/brand");
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nc-web-build-"));
  await build(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

// The relative path from a page to the site root, where the shared files are.
const siteRoot = (page: string) => "../".repeat(page.split("/").length - 1);

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

  for (const page of PAGES) {
    expect(await readFile(join(dir, page), "utf8")).toContain(`<link rel="icon" href="${siteRoot(page)}icon.svg" type="image/svg+xml" />`);
  }
});

// The content of each tag in html that has the attribute, such as property="og:url".
const contents = (html: string, attribute: string): string[] =>
  [...html.matchAll(new RegExp(`<meta ${attribute} content="([^"]*)" />`, "g"))].map(match => match[1] ?? "");

test("canonical URLs are the paths Workers static assets serve without redirecting", () => {
  expect(canonicalUrl("index.html")).toBe("https://nc.a2f0.net/");
  expect(canonicalUrl("privacy.html")).toBe("https://nc.a2f0.net/privacy");
  expect(canonicalUrl("android/support.html")).toBe("https://nc.a2f0.net/android/support");
});

test("every page has its canonical URL, theme color, and social cards from its own title and description", async () => {
  const titles = new Set<string>(), descriptions = new Set<string>();
  for (const page of PAGES) {
    const html = await readFile(join(dir, page), "utf8");
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
    const [description = ""] = contents(html, 'name="description"');
    titles.add(title);
    descriptions.add(description);
    const url = canonicalUrl(page);
    expect({ page, canonical: [...html.matchAll(/<link rel="canonical" href="([^"]*)" \/>/g)].map(m => m[1]) })
      .toEqual({ page, canonical: [url] });
    expect({ page, tags: {
      "og:type": contents(html, 'property="og:type"'),
      "og:site_name": contents(html, 'property="og:site_name"'),
      "og:title": contents(html, 'property="og:title"'),
      "og:description": contents(html, 'property="og:description"'),
      "og:url": contents(html, 'property="og:url"'),
      "og:image": contents(html, 'property="og:image"'),
      "og:image:width": contents(html, 'property="og:image:width"'),
      "og:image:height": contents(html, 'property="og:image:height"'),
      "twitter:card": contents(html, 'name="twitter:card"'),
    } }).toEqual({ page, tags: {
      "og:type": ["website"],
      "og:site_name": ["Noise Connoisseur"],
      "og:title": [title],
      "og:description": [description],
      "og:url": [url],
      "og:image": [`${SITE_URL}/og-image.png`],
      "og:image:width": ["1200"],
      "og:image:height": ["630"],
      "twitter:card": ["summary_large_image"],
    } });
    expect(contents(html, 'property="og:image:alt"')[0]).toBeTruthy();
    expect(html).toContain('<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />');
    expect(html).toContain('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000" />');
    expect(html).not.toContain('name="robots"');
  }
  expect(titles.size).toBe(PAGES.length);
  expect(descriptions.size).toBe(PAGES.length);
  expect(() => withMetadata("broken.html", "<title>Broken</title>")).toThrow("broken.html");
});

test("the social preview image is a 1200x630 PNG without transparency", async () => {
  const png = await readFile(join(dir, "og-image.png"));
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  expect(png[25]).toBe(2); // Truecolor, with no alpha channel.
});

test("the landing page describes the web app in JSON-LD", async () => {
  const html = await readFile(join(dir, "index.html"), "utf8");
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(blocks).toHaveLength(1);
  expect(JSON.parse(blocks[0]?.[1] ?? "")).toEqual({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Noise Connoisseur",
    url: canonicalUrl("index.html"),
    description: contents(html, 'name="description"')[0],
    applicationCategory: "MultimediaApplication",
    // Only the web: list the native apps once they're in the stores.
    operatingSystem: "Web",
  });
});

test("robots.txt allows crawling and names the sitemap of every page", async () => {
  expect(await readFile(join(dir, "robots.txt"), "utf8"))
    .toBe("User-agent: *\nAllow: /\n\nSitemap: https://nc.a2f0.net/sitemap.xml\n");
  const sitemap = await readFile(join(dir, "sitemap.xml"), "utf8");
  expect(sitemap).toStartWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  expect([...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1])).toEqual(PAGES.map(canonicalUrl));
});

test("every app page applies the saved appearance before styles and the main script", async () => {
  const script = await readFile(join(dir, "appearance-init.js"), "utf8");
  for (const page of PAGES) {
    const html = await readFile(join(dir, page), "utf8");
    const position = html.indexOf(`<script src="${siteRoot(page)}appearance-init.js"></script>`);
    expect(position).toBeGreaterThan(-1);
    expect(position).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
    if (page === "index.html") expect(position).toBeLessThan(html.indexOf('src="main.js"'));
  }

  // Execute the real emitted classic script with no app bundle or DOM body present.
  let saved: string | null = "dark";
  const localStorage = { getItem: () => saved };
  const root = { dataset: {} as Record<string, string> };
  let listener!: (event: { key: string | null; storageArea: unknown }) => void;
  const window = { addEventListener(type: string, callback: typeof listener) {
    expect(type).toBe("storage");
    listener = callback;
  } };
  runInNewContext(script, { localStorage, document: { documentElement: root }, window });
  expect(root.dataset.appearance).toBe("dark");
  saved = "light";
  listener({ key: "appearance", storageArea: {} }); // Session storage must not affect the app.
  listener({ key: "volume", storageArea: localStorage });
  expect(root.dataset.appearance).toBe("dark");
  listener({ key: "appearance", storageArea: localStorage });
  expect(root.dataset.appearance).toBe("light");
  saved = null;
  listener({ key: null, storageArea: localStorage }); // localStorage.clear() in another tab.
  expect(root.dataset.appearance).toBe("system");
  saved = "future-mode";
  listener({ key: "appearance", storageArea: localStorage });
  expect(root.dataset.appearance).toBe("system");

  root.dataset.appearance = "dark";
  runInNewContext(script, {
    get localStorage() { throw new Error("Blocked storage"); },
    document: { documentElement: root }, window,
  });
  expect(root.dataset.appearance).toBe("system");
});
