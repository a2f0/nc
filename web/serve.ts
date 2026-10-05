// Serves the built web app on localhost and rebuilds it when its sources change.
// AudioWorklet needs a secure context: localhost is one, file:// pages are not.

import { watch } from "node:fs";
import { join } from "node:path";
import { build, DIST_DIR } from "./build";

const WEB_DIR = import.meta.dir;
const port = Number(process.env.PORT ?? 8080);

await build();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    // URL parsing resolves "..", so paths stay inside dist.
    const path = new URL(request.url).pathname;
    const file = Bun.file(join(DIST_DIR, path === "/" ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});

let pending: ReturnType<typeof setTimeout> | undefined;
for (const source of ["src", "index.html", "styles.css", "../assets/icon.svg"]) {
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
