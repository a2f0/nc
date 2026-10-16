import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const helperPath = resolve(import.meta.dir, "../lib/secrets.rb");
const supportDir = resolve(import.meta.dir, "support");
const repoRoot = resolve(import.meta.dir, "../..");

// Loads a platform's secrets from a fixture tier folder in place of
// .secrets/prod, and prints the paths, the environment, and any error.
const script = `
require "json"
require "fake_fastlane"
require ARGV.fetch(0)

paths = { secrets_dir: SECRETS_DIR, google_play: GOOGLE_PLAY_JSON_KEY_PATH }
# Tests read fixtures, never the real credentials.
Object.send(:remove_const, :SECRETS_DIR)
Object.const_set(:SECRETS_DIR, ARGV.fetch(1))

platform, env = JSON.parse(ARGV.fetch(2)).values_at("platform", "env")
watched = IOS_SECRETS + ANDROID_SECRETS + ["UNRELATED"]
watched.each { |name| ENV.delete(name) }
env.each { |name, value| ENV[name] = value }
result = begin
  load_store_secrets(platform == "ios" ? IOS_SECRETS : ANDROID_SECRETS)
  loaded = { env: watched.to_h { |name| [name, ENV[name]] }.compact }
  loaded[:api_key] = app_store_connect_api_key_options if platform == "ios"
  loaded
rescue UserError => e
  { error: e.message }
end
puts JSON.generate(paths: paths, **result)
`;

const iosValues = {
  APPLE_ID: "developer@example.com",
  APP_STORE_CONNECT_ISSUER_ID: "issuer",
  APP_STORE_CONNECT_KEY_ID: "KEY123",
  ITC_TEAM_ID: "itc-team",
  MATCH_GIT_BASIC_AUTHORIZATION: "match-auth",
  MATCH_GIT_URL: "https://example.com/certificates.git",
  MATCH_PASSWORD: "match-password",
  TEAM_ID: "TEAM123",
};

let tier = "";

beforeEach(async () => {
  tier = await mkdtemp(join(tmpdir(), "nc-secrets-"));
  const shared = Object.entries({ ...iosValues, UNRELATED: "unused" })
    .map(([name, value]) => `export ${name}=${value}`)
    .join("\n");
  await writeFile(join(tier, "shared.env"), `# Copied from root.env\n${shared}\n`);
  await writeFile(join(tier, "app.env"), "NC_ANDROID_KEYSTORE_PASS=keystore-password\n");
  await writeFile(join(tier, "AuthKey_KEY123.p8"), "");
});

afterEach(async () => {
  await rm(tier, { recursive: true, force: true });
});

type Loaded = {
  paths: { secrets_dir: string; google_play: string };
  env?: Record<string, string>;
  api_key?: Record<string, string>;
  error?: string;
};

async function load(platform: "ios" | "android", env: Record<string, string> = {}): Promise<Loaded> {
  const child = Bun.spawn(
    ["ruby", "-I", supportDir, "-e", script, helperPath, tier, JSON.stringify({ platform, env })],
    { stderr: "pipe", stdout: "pipe" },
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  return JSON.parse(stdout);
}

test("store lanes read the prod tier of .secrets", async () => {
  const { paths, api_key } = await load("ios");
  expect(paths).toEqual({
    secrets_dir: join(repoRoot, ".secrets/prod"),
    google_play: join(repoRoot, ".secrets/prod/google-play-service-account-admin.json"),
  });
  expect(api_key).toEqual({ key_id: "KEY123", issuer_id: "issuer", key_filepath: join(tier, "AuthKey_KEY123.p8") });
});

test("iOS lanes load only their values", async () => {
  expect((await load("ios")).env).toEqual(iosValues);
});

test("Android lanes load only the keystore password", async () => {
  expect((await load("android")).env).toEqual({ NC_ANDROID_KEYSTORE_PASS: "keystore-password" });
});

test("app.env overrides shared.env", async () => {
  await writeFile(join(tier, "app.env"), "TEAM_ID=APPTEAM\nNC_ANDROID_KEYSTORE_PASS=keystore-password\n");
  expect((await load("ios")).env).toEqual({ ...iosValues, TEAM_ID: "APPTEAM" });
});

test("the environment overrides both files", async () => {
  const { env } = await load("android", { NC_ANDROID_KEYSTORE_PASS: "from-environment" });
  expect(env).toEqual({ NC_ANDROID_KEYSTORE_PASS: "from-environment" });
});

test("a missing file names the path to set up", async () => {
  await rm(join(tier, "shared.env"));
  expect((await load("android")).error).toBe(`Missing ${join(tier, "shared.env")}. Is the .secrets symlink set up?`);
});
