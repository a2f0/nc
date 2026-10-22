import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fastlaneDir = resolve(import.meta.dir, "..");
const helperPath = join(fastlaneDir, "lib/native_release_target.rb");
const supportDir = resolve(import.meta.dir, "support");
const repoRoot = resolve(fastlaneDir, "..");

// Loads the tier module, the Appfile (as fastlane evaluates it: without a file
// path, from its own folder), or the Fastfile in a fresh Ruby, and prints what
// they resolved, the environment a platform's secrets loaded, or the error.
const script = `
require "json"
require "fake_fastlane"

$appfile = {}
def app_identifier(value) = $appfile[:app_identifier] = value
def package_name(value) = $appfile[:package_name] = value

helper, fastlane_dir, request = ARGV
mode, platform, env = JSON.parse(request).values_at("mode", "platform", "env")
result = begin
  case mode
  when "appfile"
    Dir.chdir(fastlane_dir) { eval(File.read("Appfile")) }
    $appfile
  when "fastfile"
    { lanes: FakeFastfile.new(File.join(fastlane_dir, "Fastfile"), {}).lane_names }
  else
    require helper
    resolved = { tier: NATIVE_RELEASE_TIER, app_identifier: NATIVE_APP_IDENTIFIER, secrets_dir: SECRETS_DIR,
                 google_play: GOOGLE_PLAY_JSON_KEY_PATH, keystore: ANDROID_KEYSTORE_PATH }
    if mode == "load"
      watched = IOS_SECRETS + ANDROID_SECRETS + %w[UNRELATED NC_ANDROID_KEYSTORE_PASS]
      watched.each { |name| ENV.delete(name) }
      env.each { |name, value| ENV[name] = value }
      load_store_secrets(platform == "ios" ? IOS_SECRETS : ANDROID_SECRETS)
      resolved[:env] = watched.to_h { |name| [name, ENV[name]] }.compact
      resolved[:api_key] = app_store_connect_api_key_options if platform == "ios"
    end
    resolved
  end
rescue UserError => e
  { error: e.message }
end
puts JSON.generate(result)
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
const androidValues = {
  ANDROID_KEYSTORE_STORE_PASS: "store-password",
  ANDROID_KEYSTORE_KEY_PASS: "key-password",
};
const androidEnv = Object.entries(androidValues).map(([name, value]) => `${name}=${value}\n`).join("");

let tier = "";

beforeEach(async () => {
  tier = await mkdtemp(join(tmpdir(), "nc-secrets-"));
  const shared = Object.entries({ ...iosValues, UNRELATED: "unused" })
    .map(([name, value]) => `export ${name}=${value}`)
    .join("\n");
  await writeFile(join(tier, "shared.env"), `# Copied from root.env\n${shared}\n`);
  // app.env keeps the retired single password until it's deleted; the lanes ignore it.
  await writeFile(join(tier, "app.env"), `${androidEnv}NC_ANDROID_KEYSTORE_PASS=retired\n`);
  await writeFile(join(tier, "AuthKey_KEY123.p8"), "");
});

afterEach(async () => {
  await rm(tier, { recursive: true, force: true });
});

type Result = {
  tier?: string;
  app_identifier?: string;
  package_name?: string;
  secrets_dir?: string;
  google_play?: string;
  keystore?: string;
  env?: Record<string, string>;
  api_key?: Record<string, string>;
  lanes?: Record<string, string[]>;
  error?: string;
};

type Request = {
  mode?: "resolve" | "load" | "appfile" | "fastfile";
  platform?: "ios" | "android";
  env?: Record<string, string>;
  // NATIVE_RELEASE_TIER and NATIVE_RELEASE_SECRETS_DIR; the secrets folder
  // defaults to the fixture, and null leaves a variable unset.
  tier?: string | null;
  secretsDir?: string | null;
};

async function run({ mode = "load", platform = "ios", env = {}, tier: name = null, secretsDir }: Request = {}): Promise<Result> {
  const environment: Record<string, string | undefined> = { ...process.env };
  delete environment.NATIVE_RELEASE_TIER;
  delete environment.NATIVE_RELEASE_SECRETS_DIR;
  if (name !== null) environment.NATIVE_RELEASE_TIER = name;
  const dir = secretsDir === undefined ? tier : secretsDir;
  if (dir !== null) environment.NATIVE_RELEASE_SECRETS_DIR = dir;
  const child = Bun.spawn(
    ["ruby", "-I", supportDir, "-e", script, helperPath, fastlaneDir, JSON.stringify({ mode, platform, env })],
    { stderr: "pipe", stdout: "pipe", env: environment },
  );
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  return JSON.parse(stdout);
}

test("production is the default tier and reads the prod folder of .secrets", async () => {
  expect(await run({ mode: "resolve", secretsDir: null })).toEqual({
    tier: "production",
    app_identifier: "net.a2f0.nc",
    secrets_dir: join(repoRoot, ".secrets/prod"),
    google_play: join(repoRoot, ".secrets/prod/google-play-service-account-admin.json"),
    keystore: join(repoRoot, ".secrets/prod/nc-upload.keystore"),
  });
  expect((await run({ mode: "resolve", tier: "production", secretsDir: null })).secrets_dir).toBe(join(repoRoot, ".secrets/prod"));
});

test("NATIVE_RELEASE_SECRETS_DIR names another folder, relative to the repository root", async () => {
  const { secrets_dir, google_play, keystore } = await run({ mode: "resolve" });
  expect({ secrets_dir, google_play, keystore }).toEqual({
    secrets_dir: tier,
    google_play: join(tier, "google-play-service-account-admin.json"),
    keystore: join(tier, "nc-upload.keystore"),
  });
  expect((await run({ mode: "resolve", secretsDir: "fixtures/secrets" })).secrets_dir).toBe(join(repoRoot, "fixtures/secrets"));
});

test("an undeclared or unknown tier fails before any lane is defined, naming the declared tiers", async () => {
  const error = 'Unknown NATIVE_RELEASE_TIER "staging"; nc declares production.';
  expect(await run({ mode: "resolve", tier: "staging" })).toEqual({ error });
  expect(await run({ mode: "appfile", tier: "staging" })).toEqual({ error });
  expect(await run({ mode: "fastfile", tier: "staging" })).toEqual({ error });
  expect(await run({ mode: "resolve", tier: "prod" })).toEqual({ error: 'Unknown NATIVE_RELEASE_TIER "prod"; nc declares production.' });
});

test("the Appfile reads the app identifier from the tier", async () => {
  expect(await run({ mode: "appfile" })).toEqual({ app_identifier: "net.a2f0.nc", package_name: "net.a2f0.nc" });
  expect(await run({ mode: "appfile", tier: "production" })).toEqual({ app_identifier: "net.a2f0.nc", package_name: "net.a2f0.nc" });
});

test("iOS lanes load only their values and find the API key in the secrets folder", async () => {
  const { env, api_key } = await run({ platform: "ios" });
  expect(env).toEqual(iosValues);
  expect(api_key).toEqual({ key_id: "KEY123", issuer_id: "issuer", key_filepath: join(tier, "AuthKey_KEY123.p8") });
});

test("Android lanes load only the upload key's store and key passwords", async () => {
  expect((await run({ platform: "android" })).env).toEqual(androidValues);
});

test("app.env overrides shared.env", async () => {
  await writeFile(join(tier, "app.env"), `TEAM_ID=APPTEAM\n${androidEnv}`);
  expect((await run({ platform: "ios" })).env).toEqual({ ...iosValues, TEAM_ID: "APPTEAM" });
});

test("the environment overrides both files", async () => {
  const { env } = await run({ platform: "android", env: { ANDROID_KEYSTORE_KEY_PASS: "from-environment" } });
  expect(env).toEqual({ ...androidValues, ANDROID_KEYSTORE_KEY_PASS: "from-environment" });
});

test("a missing file names the path to set up", async () => {
  await rm(join(tier, "shared.env"));
  expect((await run({ platform: "android" })).error).toBe(`Missing ${join(tier, "shared.env")}. Is the .secrets symlink set up?`);
});
