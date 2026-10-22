import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const fastlaneDir = resolve(import.meta.dir, "..");

// Runs the Fastfile's iOS signing lanes against fake actions
// (support/fake_fastlane.rb) and prints what each scenario recorded.
const script = `
require "fileutils"
require "json"
require "tmpdir"
require "fake_fastlane"

FASTFILE = File.join(ARGV.fetch(0), "Fastfile")
work = Dir.mktmpdir("nc-lanes-")
at_exit { FileUtils.rm_rf(work) }

ENV["APPLE_ID"] = "developer@example.com"
ENV["TEAM_ID"] = "TEAM123"
%w[MATCH_KEYCHAIN_NAME MATCH_KEYCHAIN_PASSWORD MATCH_READONLY].each { |name| ENV.delete(name) }

# The security tool, as far as the keychain search list goes.
SEARCH_LIST = ["/keychains/login.keychain-db"]
SECURITY = lambda do |*args, **|
  SEARCH_LIST.replace(args.drop(args.index("-s") + 1)) if args.include?("-s")
  SEARCH_LIST.map { |path| "    \\"#{path}\\"\\n" }.join
end

# match records the environment the signing keychain gives it, and the search
# list it signs with.
def fake_lanes(events, lock_path, extra_stubs = {})
  lanes = FakeFastfile.new(FASTFILE, {
    produce: ->(**) {}, app_store_connect_api_key: ->(**) { "api-key" },
    create_keychain: ->(**) {}, delete_keychain: ->(**) {}, sh: SECURITY,
    match: lambda do |**|
      events << ["match", ENV["MATCH_READONLY"], ENV["MATCH_KEYCHAIN_NAME"]]
      events << ["search", SEARCH_LIST.dup]
    end }.merge(extra_stubs))
  # The store credentials in .secrets aren't available to tests.
  lanes.stub_method(:load_store_secrets) { |_names| nil }
  lanes.stub_method(:app_store_connect_api_key_options) { { key_id: "KEY123" } }
  # The release lock lives in ~/Library/Keychains, which CI's Linux lacks.
  IosSigningKeychain.lock_path = lock_path
  lanes
end

lock_path = File.join(work, "release.lock")
results = { lanes: FakeFastfile.new(FASTFILE, {}).lane_names }

events = []
lanes = fake_lanes(events, lock_path)
lanes.run_lane(:ios, :profiles)
results[:profiles] = {
  match: lanes.calls_to(:match), events: events,
  keychain: lanes.calls_to(:create_keychain).first&.fetch(:name),
  after: ENV.values_at("MATCH_READONLY", "MATCH_KEYCHAIN_NAME"),
  search_after: SEARCH_LIST.dup
}

events = []
lanes = fake_lanes(events, lock_path)
lanes.run_lane(:ios, :profiles, { force: "true" })
results[:profiles_force] = { match: lanes.calls_to(:match) }

events = []
Spaceship::Portal.events = events
Spaceship::Portal.groups = {}
lanes = fake_lanes(events, lock_path)
lanes.run_lane(:ios, :create_app)
results[:create_app] = { produce: lanes.calls_to(:produce), match: lanes.calls_to(:match), events: events }

# Both paths must build once, with the same artifact receipt; only upload_release uploads.
def Readiness.source(_root) = { 'commit' => 'a' * 40, 'dirty' => false }
%i[build_release upload_release].each do |lane|
  artifact = File.join(work, "#{lane}.ipa")
  events = []
  lanes = fake_lanes(events, lock_path,
    latest_testflight_build_number: ->(**) { 11 },
    build_app: ->(**) { File.write(artifact, 'signed fixture'); artifact },
    upload_to_testflight: ->(**) { raise 'missing receipt before upload' unless File.file?("#{artifact}.build.json") })
  lanes.stub_method(:with_manual_ios_signing) { |*_args, &block| block.call }
  returned = lanes.run_lane(:ios, lane, build_number: '42')
  results[lane] = {
    builds: lanes.calls_to(:build_app), uploads: lanes.calls_to(:upload_to_testflight),
    lookups: lanes.calls_to(:latest_testflight_build_number),
    returned_artifact: returned == artifact,
    receipt_hash: JSON.parse(File.read("#{artifact}.build.json"))['sha256'],
    expected_hash: Digest::SHA256.file(artifact).hexdigest,
    search_after: SEARCH_LIST.dup
  }
end
puts JSON.generate(results)
`;

const results = (() => {
  const supportDir = resolve(import.meta.dir, "support");
  const child = Bun.spawnSync(
    ["ruby", "-I", supportDir, "-e", script, fastlaneDir],
    { stderr: "pipe", stdout: "pipe" },
  );
  if (child.exitCode !== 0) {
    throw new Error(
      `ruby exited with ${child.exitCode}: ${child.stderr.toString()}`,
    );
  }
  return JSON.parse(child.stdout.toString());
})();

const appStoreProfiles = {
  type: "appstore",
  app_identifier: ["net.a2f0.nc", "net.a2f0.nc.widget"],
  api_key: "api-key",
  readonly: false,
};

describe("ios signing lanes", () => {
  test("profiles creates or renews the profiles with the API key in a temporary keychain", () => {
    const { keychain, ...result } = results.profiles;
    expect(keychain).toMatch(/^nc-fastlane-/);
    expect(result).toEqual({
      match: [{ ...appStoreProfiles, force: false }],
      // The signing keychain makes match read-only; profiles overrides that.
      // It's searched first while the lane runs.
      events: [
        ["match", "true", keychain],
        ["search", [`/keychains/${keychain}-db`, "/keychains/login.keychain-db"]],
      ],
      after: [null, null],
      search_after: ["/keychains/login.keychain-db"],
    });
  });

  test("profiles regenerates the profiles with force:true", () => {
    expect(results.profiles_force.match).toEqual([
      { ...appStoreProfiles, force: true },
    ]);
  });

  test("create_app creates the profiles with the API key after the App Group association", () => {
    const { produce, match, events } = results.create_app;
    expect(produce).toEqual([
      expect.objectContaining({
        app_identifier: "net.a2f0.nc",
        enable_services: { app_group: "on" },
      }),
      expect.objectContaining({
        app_identifier: "net.a2f0.nc.widget",
        skip_itc: true,
      }),
    ]);
    expect(events).toEqual([
      ["login", "developer@example.com"],
      ["select_team", "TEAM123"],
      ["create_app_group", "group.net.a2f0.nc", "Noise Connoisseur"],
      ["associate_groups", "net.a2f0.nc", ["group.net.a2f0.nc"]],
      ["associate_groups", "net.a2f0.nc.widget", ["group.net.a2f0.nc"]],
      ["match", "true", expect.stringMatching(/^nc-fastlane-/)],
      [
        "search",
        [
          expect.stringMatching(/^\/keychains\/nc-fastlane-.+-db$/),
          "/keychains/login.keychain-db",
        ],
      ],
    ]);
    expect(match).toEqual([{ ...appStoreProfiles, force: false }]);
  });
});

test("the Fastfile imports the standard lanes and nc's own", () => {
  expect(results.lanes).toEqual({
    ios: ["register_identifiers", "profiles", "create_app", "build_release", "upload_release", "readiness", "listing"],
    android: [
      "foreground_service_video", "publish_foreground_service_video", "build_release", "upload_release",
      "promote_release", "readiness", "listing",
    ],
  });
});

test("release builds write receipts before upload_release uploads and preserve build options", () => {
  for (const lane of ["build_release", "upload_release"]) {
    const result = results[lane];
    expect(result.builds).toHaveLength(1);
    expect(result.builds[0].xcargs).toContain("CURRENT_PROJECT_VERSION=42");
    expect(result.lookups).toEqual([]);
    expect(result.receipt_hash).toBe(result.expected_hash);
    expect(result.search_after).toEqual(["/keychains/login.keychain-db"]);
  }
  expect(results.build_release.returned_artifact).toBe(true);
  expect(results.build_release.uploads).toEqual([]);
  expect(results.upload_release.uploads).toEqual([
    expect.objectContaining({
      ipa: expect.stringContaining("upload_release.ipa"), app_identifier: "net.a2f0.nc", api_key: "api-key",
      skip_submission: true, skip_waiting_for_build_processing: true,
    }),
  ]);
});
