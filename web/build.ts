// Builds the web app into web/dist. The page script and the audio worklet are separate
// bundles because the worklet is loaded by URL.

import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const WEB_DIR = import.meta.dir;
export const DIST_DIR = join(WEB_DIR, "dist");
const ICON_SVG = join(WEB_DIR, "../assets/icon.svg");

export async function build(): Promise<void> {
  await rm(DIST_DIR, { recursive: true, force: true });

  const result = await Bun.build({
    entrypoints: [join(WEB_DIR, "src/main.ts"), join(WEB_DIR, "src/noiseProcessor.ts")],
    outdir: DIST_DIR,
    naming: "[name].[ext]",
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "linked",
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "Web build failed");
  }

  await cp(join(WEB_DIR, "index.html"), join(DIST_DIR, "index.html"));
  await cp(join(WEB_DIR, "styles.css"), join(DIST_DIR, "styles.css"));

  // The favicon is the app mark, drawn white on dark browser chrome.
  const icon = await readFile(ICON_SVG, "utf8");
  const darkStyle = "<style>@media (prefers-color-scheme: dark) { rect { fill: #FFFFFF; } }</style>";
  await writeFile(join(DIST_DIR, "icon.svg"), icon.replace(/<svg[^>]*>/, (tag) => `${tag}\n  ${darkStyle}`));
}

if (import.meta.main) {
  await build();
  console.log(`Built ${DIST_DIR}`);
}
