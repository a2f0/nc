import { LOCALES, localeText, type Locale } from "../l10n/locales";
import { bestLocale, type WebKey } from "./src/l10n";

// The small subset of the R2 binding used here; no runtime SDK is needed.
interface ObjectInfo { size: number; httpEtag: string }
interface ObjectBody extends ObjectInfo { body: ReadableStream; text(): Promise<string> }
export interface EvidenceBucket {
  head(key: string): Promise<ObjectInfo | null>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<ObjectBody | null>;
}
export interface Env {
  PLAY_EVIDENCE: EvidenceBucket;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
interface Manifest {
  schema_version: 1;
  application_id: "net.a2f0.nc";
  video_key: string;
  video_sha256: string;
  version_name: string;
  version_code: string;
  recorded_at: string;
}
const BASE = "/review/android-media-playback";
const KEY = /^android-media-playback\/[a-f0-9]{64}\.mp4$/;
const escape = (value: string) => value.replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.schema_version === 1 && v.application_id === "net.a2f0.nc" &&
    typeof v.video_key === "string" && KEY.test(v.video_key) &&
    v.video_key === `android-media-playback/${v.video_sha256}.mp4` &&
    typeof v.version_name === "string" && v.version_name.length > 0 && v.version_name.length <= 100 &&
    typeof v.version_code === "string" && /^[1-9][0-9]*$/.test(v.version_code) &&
    typeof v.recorded_at === "string" && Number.isFinite(Date.parse(v.recorded_at));
}

async function manifest(bucket: EvidenceBucket): Promise<Manifest | null> {
  const object = await bucket.get("android-media-playback/current.json");
  if (!object || object.size > 32 * 1024) return null;
  const value: unknown = JSON.parse(await object.text());
  return isManifest(value) ? value : null;
}

function language(request: Request): Locale {
  const preferences = (request.headers.get("Accept-Language") ?? "en").split(",").map(part => {
    const [tag, ...params] = part.trim().split(";");
    const q = params.map(p => p.trim()).find(p => p.startsWith("q="));
    return { tag: tag ?? "", quality: q ? Number(q.slice(2)) : 1 };
  }).filter(p => p.quality > 0 && p.quality <= 1).sort((a, b) => b.quality - a.quality);
  return bestLocale(preferences.map(p => p.tag), LOCALES);
}

function page(data: Manifest, locale: Locale): string {
  const text = (key: WebKey) => escape(localeText(locale, key));
  const url = `/review/${data.video_key}`;
  return `<!doctype html><html lang="${escape(locale.tag)}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${text("review_title")} · ${text("app_name")}</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;color:#222;background:#fafafa;accent-color:#555}
body{max-width:48rem;margin:auto;padding:2rem 1rem;line-height:1.6}
a{color:inherit;text-underline-offset:.2em}a:focus-visible,video:focus-visible{outline:3px solid #777;outline-offset:4px}
::selection{background:#555;color:#fff}video{display:block;max-width:100%;height:min(65vh,40rem);margin:1.5rem auto;background:#111;filter:grayscale(1)}
@media(prefers-color-scheme:dark){:root{color:#eee;background:#171717}}
</style>
<main><a href="/">${text("app_name")}</a><h1>${text("review_title")}</h1>
<p>${text("review_intro")}</p>
<video controls playsinline preload="metadata" aria-label="${text("review_title")}" aria-describedby="steps" src="${url}">
<a href="${url}">${text("review_download")}</a></video>
<ol id="steps"><li>${text("review_start")}</li><li>${text("review_background")}</li><li>${text("review_stop")}</li></ol>
<p>${text("review_capture")}</p>
<p>${text("review_build")}: ${escape(data.version_name)} (${escape(String(data.version_code))})<br>
${text("review_recorded")}: <time datetime="${escape(data.recorded_at)}">${escape(data.recorded_at)}</time></p>
<p><a href="${url}" download="android-media-playback.mp4">${text("review_download")}</a>
 · <a href="${BASE}.json">${text("review_details")}</a></p></main></html>`;
}

async function video(request: Request, bucket: EvidenceBucket, key: string): Promise<Response> {
  const object = await bucket.head(key);
  if (!object) return new Response(null, { status: 404, headers });
  const h = new Headers({ ...headers, "Content-Type": "video/mp4", "Accept-Ranges": "bytes",
    "Cache-Control": "public,max-age=31536000,immutable", ETag: object.httpEtag });
  const tags = request.headers.get("If-None-Match")?.split(",").map(v => v.trim().replace(/^W\//, ""));
  if (tags?.includes(object.httpEtag) || tags?.includes("*")) return new Response(null, { status: 304, headers: h });
  let offset = 0, length = object.size, partial = false;
  // HEAD ignores Range. Unsupported/malformed/multiple ranges use a full 200.
  const range = request.method === "GET" && request.headers.get("Range")?.match(/^bytes=(\d*)-(\d*)$/);
  const ifRange = request.headers.get("If-Range");
  if (range && (range[1] || range[2]) && (!ifRange || ifRange === object.httpEtag)) {
    offset = range[1] ? Number(range[1]) : Math.max(0, object.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), object.size - 1) : object.size - 1;
    length = end - offset + 1;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length <= 0 || offset >= object.size) {
      h.set("Content-Range", `bytes */${object.size}`);
      return new Response(null, { status: 416, headers: h });
    }
    partial = true;
    h.set("Content-Range", `bytes ${offset}-${end}/${object.size}`);
  }
  h.set("Content-Length", String(length));
  if (request.method === "HEAD") return new Response(null, { headers: h });
  const body = await bucket.get(key, partial ? { range: { offset, length } } : undefined);
  if (!body) return new Response(null, { status: 404, headers });
  return new Response(body.body, { status: partial ? 206 : 200, headers: h });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/review/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
    }
    try {
      const key = path.slice("/review/".length);
      if (KEY.test(key)) return await video(request, env.PLAY_EVIDENCE, key);
      if (![BASE, `${BASE}.json`, `${BASE}.mp4`].includes(path)) return new Response(null, { status: 404, headers });
      const data = await manifest(env.PLAY_EVIDENCE);
      if (!data) return new Response(null, { status: 404, headers });
      if (path.endsWith(".mp4")) {
        return new Response(null, { status: 307, headers: { ...headers, Location: `/review/${data.video_key}` } });
      }
      const json = path.endsWith(".json");
      return new Response(request.method === "HEAD" ? null : json ? JSON.stringify(data) : page(data, language(request)), {
        headers: { ...headers, Vary: "Accept-Language", "Content-Type": json ? "application/json" : "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; base-uri 'none'; frame-ancestors 'none'" },
      });
    } catch {
      return new Response(null, { status: 503, headers });
    }
  },
};
