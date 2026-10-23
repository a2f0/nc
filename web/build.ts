// Builds the web app into web/dist with separate page, audio-worklet, and tracker
// bundles. Only the production CLI --tracking flag enables the tracker.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const WEB_DIR = import.meta.dir;
const REPO_ROOT = join(WEB_DIR, "..");
export const DIST_DIR = join(WEB_DIR, "dist");
const PACKAGE_JSON = join(REPO_ROOT, "package.json");
const AGENT_TOOL = join(REPO_ROOT, "node_modules/.bin/agent-tool");
// The website's pages, and the privacy and support pages the iOS and Android apps link to.
export const PAGES = [
  "index.html", "privacy.html", "support.html",
  "ios/privacy.html", "ios/support.html", "android/privacy.html", "android/support.html",
];
// Served with status 404 for every path outside /review/ that has no page or file
// (not_found_handling in wrangler.jsonc), at any depth, so its links are root-relative.
// Not in PAGES: it has no canonical URL, stays out of the sitemap, and is noindex because
// /404 itself answers 200.
export const NOT_FOUND_PAGE = "404.html";
// The production site, the only one: there is no staging deployment.
export const SITE_URL = "https://nc.a2f0.net";
// The social preview image, the web target's og-image.png in agent-tool.json.
const OG_IMAGE = { path: "og-image.png", width: 1200, height: 630, alt: "The Noise Connoisseur logo, an LCD equalizer" };

// Workers static assets serve privacy.html at /privacy and index.html at /, redirecting the
// .html forms there, so those are the canonical URLs.
export function canonicalUrl(page: string): string {
  return `${SITE_URL}/${page === "index.html" ? "" : page.replace(/\.html$/, "")}`;
}

export async function build(outDir: string = DIST_DIR, tracking = false): Promise<void> {
  await rm(outDir, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [join(WEB_DIR, "src/main.ts"), join(WEB_DIR, "src/noiseProcessor.ts"), join(WEB_DIR, "src/clickTracking.ts")],
    outdir: outDir,
    naming: "[name].[ext]",
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "linked",
    define: { APP_VERSION: JSON.stringify(await appVersion()), CT_ENABLED: JSON.stringify(tracking) },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Web build failed");
  }

  const appearance = await Bun.build({
    entrypoints: [join(WEB_DIR, "src/appearance-init.ts")],
    outdir: outDir, naming: "[name].[ext]", target: "browser", format: "iife", minify: true,
  });
  if (!appearance.success) throw new AggregateError(appearance.logs, "Appearance bootstrap build failed");

  for (const page of PAGES) {
    await mkdir(dirname(join(outDir, page)), { recursive: true });
    await writeFile(join(outDir, page), withMetadata(page, await readFile(join(WEB_DIR, page), "utf8")));
  }
  const notFound = await readFile(join(WEB_DIR, NOT_FOUND_PAGE), "utf8");
  await writeFile(join(outDir, NOT_FOUND_PAGE), afterTitle(NOT_FOUND_PAGE, notFound, THEME_COLORS));
  await cp(join(WEB_DIR, "styles.css"), join(outDir, "styles.css"));
  await writeFile(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  await writeFile(join(outDir, "sitemap.xml"), sitemap());

  await buildImages(outDir);
}

// The browser's theme color, the page background in styles.css; applyAppearance() follows
// a chosen appearance.
const THEME_COLORS = [
  `<meta name="theme-color" data-scheme="light" media="(prefers-color-scheme: light)" content="#ffffff" />`,
  `<meta name="theme-color" data-scheme="dark" media="(prefers-color-scheme: dark)" content="#000000" />`,
];

// Adds the search and social metadata every page shares after its <title>: the canonical
// URL, the theme color, and Open Graph and Twitter cards built from the page's own title
// and description.
export function withMetadata(page: string, html: string): string {
  const title = /^ *<title>([^<]+)<\/title>$/m.exec(html)?.[1];
  const description = /<meta name="description" content="([^"]+)" \/>/.exec(html)?.[1];
  if (!title || !description) {
    throw new Error(`${page} needs a <title> line and a <meta name="description">`);
  }
  const url = canonicalUrl(page);
  return afterTitle(page, html, [
    `<link rel="canonical" href="${url}" />`,
    ...THEME_COLORS,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Noise Connoisseur" />`,
    `<meta property="og:title" content="${title.replaceAll('"', "&quot;")}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${SITE_URL}/${OG_IMAGE.path}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${OG_IMAGE.alt}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ]);
}

// Inserts tags after the page's <title> line, at its indentation.
function afterTitle(page: string, html: string, tags: string[]): string {
  const [line, indent] = /^( *)<title>[^<]+<\/title>$/m.exec(html) ?? [];
  if (!line || indent === undefined) throw new Error(`${page} needs a <title> line`);
  return html.replace(line, () => [line, ...tags.map(tag => indent + tag)].join("\n"));
}

// Every page, at its canonical URL.
function sitemap(): string {
  const urls = PAGES.map(page => `  <url><loc>${canonicalUrl(page)}</loc></url>`);
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, "</urlset>", ""].join("\n");
}

// The About sheet's version: the root package's, which shipping bumps with each change
// (see "Shipping" in AGENTS.md).
async function appVersion(): Promise<string> {
  const { version } = (await Bun.file(PACKAGE_JSON).json()) as { version?: unknown };
  if (typeof version !== "string") throw new Error(`No version in ${PACKAGE_JSON}`);
  return version;
}

// The web target in agent-tool.json, rendered from assets/brand/: the favicon, also the logo
// beside the title, is the app icon with rounded corners, leaving out the mark's unlit
// segments, which are noise at tab size; og-image.png is the social preview image.
async function buildImages(outDir: string): Promise<void> {
  const command = [process.execPath, AGENT_TOOL, "--repo", REPO_ROOT, "images", "build", "web", "--out", outDir];
  const agentTool = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(agentTool.stdout).text(),
    new Response(agentTool.stderr).text(),
    agentTool.exited,
  ]);
  if (exitCode !== 0) throw new Error(`agent-tool images build web failed (exit ${exitCode}):\n${stderr || stdout}`);
}

if (import.meta.main) {
  await build(DIST_DIR, process.argv.includes("--tracking"));
  console.log(`Built ${DIST_DIR}`);
}
