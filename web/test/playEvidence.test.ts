import { describe, expect, test } from "bun:test";
import worker, { type Env, type EvidenceBucket } from "../worker";

const hash = "a".repeat(64);
const key = `android-media-playback/${hash}.mp4`;
const data = { schema_version: 1, application_id: "net.a2f0.nc", video_key: key, video_sha256: hash,
  version_name: "1.0", version_code: "16", recorded_at: "2026-10-20T15:00:00Z" };
const bytes = "0123456789";
function fixture(value: unknown = data) {
  const reads: string[] = [];
  const bucket: EvidenceBucket = {
    async head(k) { reads.push(k); return k === key ? { size: bytes.length, httpEtag: '"video"' } : null; },
    async get(k, options) {
      reads.push(k);
      const full = k === key ? bytes : k === "android-media-playback/current.json" && value !== null ? JSON.stringify(value) : null;
      if (full === null) return null;
      const range = options?.range;
      const part = range ? full.slice(range.offset, range.offset + range.length) : full;
      return { size: full.length, httpEtag: '"video"', text: async () => part,
        body: new Response(part).body! };
    },
  };
  const env: Env = { PLAY_EVIDENCE: bucket, ASSETS: { fetch: async () => new Response("app") } };
  return { reads, fetch: (path: string, init?: RequestInit) => worker.fetch(new Request(`https://nc.a2f0.net${path}`, init), env) };
}
const path = `/review/${key}`;

describe("public Play review evidence", () => {
  test("preserves static app routes and exposes only the evidence namespace", async () => {
    const f = fixture();
    expect(await (await f.fetch("/")).text()).toBe("app");
    expect((await f.fetch("/review/private.json")).status).toBe(404);
    expect((await f.fetch(path, { method: "PUT", body: "overwrite" })).status).toBe(405);
    expect(f.reads).toEqual([]);
  });
  test("stable page and video alias follow the current immutable recording without caching the pointer", async () => {
    const f = fixture();
    const page = await f.fetch("/review/android-media-playback");
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    const html = await page.text();
    expect(html).toContain(`src="${path}"`);
    expect(html).toContain("controls playsinline");
    expect(html).not.toContain("autoplay");
    expect(html).toContain('aria-describedby="steps"');
    const redirect = await f.fetch("/review/android-media-playback.mp4");
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("Location")).toBe(path);
    expect(await (await f.fetch("/review/android-media-playback.json")).json()).toEqual(data);
  });
  test("escapes version text and rejects unsafe object keys or missing evidence", async () => {
    const f = fixture({ ...data, version_name: '<img src=x onerror="bad">' });
    const html = await (await f.fetch("/review/android-media-playback")).text();
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    for (const value of [null, { ...data, video_key: "../private" }, { ...data, video_sha256: "b".repeat(64) }]) {
      expect((await fixture(value).fetch("/review/android-media-playback")).status).toBe(404);
    }
  });
  test("streams bytes with seeking, suffix ranges, cache validation and HEAD", async () => {
    const f = fixture();
    const full = await f.fetch(path);
    expect(full.status).toBe(200);
    expect(await full.text()).toBe(bytes);
    expect(full.headers.get("Content-Type")).toBe("video/mp4");
    for (const [range, content, contentRange] of [
      ["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=7-", "789", "bytes 7-9/10"],
    ]) {
      const response = await f.fetch(path, { headers: { Range: range! } });
      expect(response.status).toBe(206);
      expect(await response.text()).toBe(content!);
      expect(response.headers.get("Content-Range")).toBe(contentRange!);
      expect(response.headers.get("Content-Length")).toBe(String(content!.length));
    }
    expect((await f.fetch(path, { headers: { "If-None-Match": 'W/"video"' } })).status).toBe(304);
    const head = await f.fetch(path, { method: "HEAD", headers: { Range: "bytes=2-5" } });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Length")).toBe("10");
    expect(await head.text()).toBe("");
    expect((await f.fetch(path, { headers: { Range: "bytes=3-5", "If-Range": '"old"' } })).status).toBe(200);
  });
  test("handles unsatisfiable and unsupported ranges without an R2 error", async () => {
    const f = fixture();
    for (const range of ["bytes=10-", "bytes=3-1", "bytes=-0"]) {
      const r = await f.fetch(path, { headers: { Range: range } });
      expect(r.status).toBe(416);
      expect(r.headers.get("Content-Range")).toBe("bytes */10");
    }
    for (const range of ["garbage", "bytes=0-1,5-9", "bytes=-"]) {
      expect((await f.fetch(path, { headers: { Range: range } })).status).toBe(200);
    }
  });
});
