// Serves the built web app on localhost and rebuilds it when its sources change.
// AudioWorklet needs a secure context: localhost is one, file:// pages are not.

import { watch } from "node:fs";
import { extname, join } from "node:path";
import { build, DIST_DIR } from "./build";

const WEB_DIR = import.meta.dir;
const port = Number(process.env.PORT ?? 8080);

await build();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    // URL parsing resolves "..", so paths stay inside dist. Like Cloudflare's static
    // assets, "/privacy" serves privacy.html.
    const path = new URL(request.url).pathname;
    const name = path === "/" ? "index.html" : extname(path) === "" ? `${path}.html` : path;
    const file = Bun.file(join(DIST_DIR, name));
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});

let pending: ReturnType<typeof setTimeout> | undefined;
for (const source of ["src", "../l10n", "index.html", "privacy.html", "support.html", "styles.css", "../assets/icon.svg", "../assets/background.svg"]) {
  watch(join(WEB_DIR, source), { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      build().then(
        () => console.log("Rebuilt; reload the page."),
        (error: unknown) => console.error(error),
      );
    }, 100);
  });
}

console.log(`Noise Connoisseur: http://localhost:${server.port}`);
