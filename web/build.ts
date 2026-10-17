// Builds the web app into web/dist. The page script and the audio worklet are separate
// bundles because the worklet is loaded by URL.

import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const WEB_DIR = import.meta.dir;
const REPO_ROOT = join(WEB_DIR, "..");
export const DIST_DIR = join(WEB_DIR, "dist");
const PACKAGE_JSON = join(REPO_ROOT, "package.json");
const AGENT_TOOL = join(REPO_ROOT, "node_modules/.bin/agent-tool");

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

  await buildIcon(outDir);
}

// The About sheet's version: the root package's, which shipping bumps with each change
// (see "Shipping" in AGENTS.md).
async function appVersion(): Promise<string> {
  const { version } = (await Bun.file(PACKAGE_JSON).json()) as { version?: unknown };
  if (typeof version !== "string") throw new Error(`No version in ${PACKAGE_JSON}`);
  return version;
}

// The favicon, also the logo beside the title, is the app icon with rounded corners,
// leaving out the mark's unlit segments, which are noise at tab size: the web target in
// agent-tool.json, rendered from assets/brand/.
async function buildIcon(outDir: string): Promise<void> {
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
  await build();
  console.log(`Built ${DIST_DIR}`);
}
