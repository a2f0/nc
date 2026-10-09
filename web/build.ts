// Builds the web app into web/dist. The page script and the audio worklet are separate
// bundles because the worklet is loaded by URL.

import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const WEB_DIR = import.meta.dir;
export const DIST_DIR = join(WEB_DIR, "dist");
const ICON_SVG = join(WEB_DIR, "../assets/icon.svg");
const BACKGROUND_SVG = join(WEB_DIR, "../assets/background.svg");
const PACKAGE_JSON = join(WEB_DIR, "../package.json");

export async function build(outDir: string = DIST_DIR): Promise<void> {
  await rm(outDir, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [join(WEB_DIR, "src/main.ts"), join(WEB_DIR, "src/noiseProcessor.ts")],
    outdir: outDir,
    naming: "[name].[ext]",
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "linked",
    define: { APP_VERSION: JSON.stringify(await appVersion()) },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Web build failed");
  }

  for (const file of ["index.html", "privacy.html", "support.html", "styles.css"]) {
    await cp(join(WEB_DIR, file), join(outDir, file));
  }

  const [background, icon] = await Promise.all([readFile(BACKGROUND_SVG, "utf8"), readFile(ICON_SVG, "utf8")]);
  await writeFile(join(outDir, "icon.svg"), favicon(background, icon));
}

// The About sheet's version: the root package's, which shipping bumps with each change
// (see "Shipping" in AGENTS.md).
async function appVersion(): Promise<string> {
  const { version } = (await Bun.file(PACKAGE_JSON).json()) as { version?: unknown };
  if (typeof version !== "string") throw new Error(`No version in ${PACKAGE_JSON}`);
  return version;
}

// The favicon is the app icon with rounded corners, leaving out the mark's unlit
// segments, which are noise at tab size. Both SVGs share a 1024 viewBox.
export function favicon(background: string, icon: string): string {
  const lit = icon.replace(/<g id="unlit"[^>]*>[\s\S]*?<\/g>/, "");
  if (lit === icon) throw new Error("assets/icon.svg has no unlit group");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <clipPath id="corners"><rect width="1024" height="1024" rx="224"/></clipPath>
  <g clip-path="url(#corners)">${svgContents(background)}${svgContents(lit)}</g>
</svg>
`;
}

function svgContents(svg: string): string {
  const contents = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1];
  if (contents === undefined) throw new Error("Not an SVG document");
  return contents;
}

if (import.meta.main) {
  await build();
  console.log(`Built ${DIST_DIR}`);
}
