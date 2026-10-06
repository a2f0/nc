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

# match records the environment the signing keychain gives it.
def fake_lanes(events, lock_path)
  lanes = FakeFastfile.new(FASTFILE,
    produce: ->(**) {}, app_store_connect_api_key: ->(**) { "api-key" },
    create_keychain: ->(**) {}, delete_keychain: ->(**) {},
    match: ->(**) { events << ["match", ENV["MATCH_READONLY"], ENV["MATCH_KEYCHAIN_NAME"]] })
  # The store credentials in .secrets aren't available to tests.
  lanes.stub_method(:load_store_secrets) { |_names| nil }
  lanes.stub_method(:app_store_connect_api_key_options) { { key_id: "KEY123" } }
  # The release lock lives in ~/Library/Keychains, which CI's Linux lacks.
  IosSigningKeychain.send(:remove_const, :DEFAULT_LOCK_PATH)
  IosSigningKeychain.const_set(:DEFAULT_LOCK_PATH, lock_path)
  lanes
end

lock_path = File.join(work, "release.lock")
results = {}

events = []
lanes = fake_lanes(events, lock_path)
lanes.run_lane(:ios, :profiles)
results[:profiles] = {
  match: lanes.calls_to(:match), events: events,
  keychain: lanes.calls_to(:create_keychain).first&.fetch(:name),
  after: ENV.values_at("MATCH_READONLY", "MATCH_KEYCHAIN_NAME")
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
      events: [["match", "true", keychain]],
      after: [null, null],
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
    ]);
    expect(match).toEqual([{ ...appStoreProfiles, force: false }]);
  });
});
