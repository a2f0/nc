import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const script = String.raw`
require 'tmpdir'
require 'json'
require 'fake_fastlane'
require File.join(ARGV[0], 'fastlane/lib/readiness')
require File.join(ARGV[0], 'fastlane/lib/play_evidence')
def PlayEvidence.fetch(*) = raise('Unexpected network request in fixture')
evidence_calls = []
original_check = PlayEvidence.method(:check)
PlayEvidence.define_singleton_method(:check) do |report, artifact, **options|
  evidence_calls << options
  original_check.call(report, artifact, **options)
end
def Readiness.source(_root) = { 'commit' => 'a' * 40, 'dirty' => false }
results = {}
Dir.mktmpdir do |dir|
  # The lanes read the fixture keystore from this folder, never from .secrets.
  ENV['NATIVE_RELEASE_SECRETS_DIR'] = dir
  key = File.join(dir, 'nc-upload.keystore')
  File.write(key, 'not a real key')
  results[:keystore] = key
  runs = {
    build_release: [:build_release, { build_number: '42' }],
    upload_release: [:upload_release, { release_status: 'draft' }],
    upload_release_beta: [:upload_release, { track: 'beta' }]
  }
  runs.each do |name, (lane, options)|
    artifact = File.join(dir, "#{name}.aab")
    events, required = [], []
    lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'),
      sh: ->(*args) { events << 'wrapper' },
      gradle: ->(**) { events << 'build'; File.write(artifact, 'signed fixture') },
      google_play_track_version_codes: ->(**args) { args[:track] == 'internal' ? [13] : [] },
      upload_to_play_store: ->(**args) {
        raise 'missing receipt before upload' unless File.file?("#{args[:aab]}.build.json")
        events << 'upload'
      })
    lanes.singleton_class.send(:remove_const, :ANDROID_RELEASE_AAB)
    lanes.singleton_class.const_set(:ANDROID_RELEASE_AAB, artifact)
    lanes.stub_method(:load_store_secrets) { |names| events << names; nil }
    lanes.stub_method(:required_env) { |name| required << name; 'fixture password' }
    returned = lanes.run_lane(:android, lane, options)
    results[name] = { events: events, required: required, gradle: lanes.calls_to(:gradle), uploads: lanes.calls_to(:upload_to_play_store),
      lookups: lanes.calls_to(:google_play_track_version_codes), returned_artifact: returned == artifact,
      receipt: JSON.parse(File.read("#{artifact}.build.json")), expected_hash: Digest::SHA256.file(artifact).hexdigest }
  end

  # An unknown track, or the old name for build_number:, fails before anything builds.
  { bad_track: [:upload_release, { track: 'qa' }], renamed_option: [:build_release, { version_code: '42' }] }.each do |name, (lane, options)|
    lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'),
      sh: ->(*) { raise 'must not run' }, gradle: ->(**) { raise 'must not build' })
    lanes.run_lane(:android, lane, options)
  rescue UserError => error
    results[name] = error.message
  end

  # promote_release promotes the open testing release, so it builds nothing.
  [{}, { version_code: '18', rollout: '0.1' }].each_with_index do |options, index|
    lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'),
      gradle: ->(**) { raise 'promote_release must not build' }, upload_to_play_store: ->(**) {})
    lanes.run_lane(:android, :promote_release, options)
    results["promote_release_#{index}"] = { uploads: lanes.calls_to(:upload_to_play_store), gradle: lanes.calls_to(:gradle) }
  end

  # listing attaches to the newest internal release; the stub keeps it from
  # staging real screenshots.
  StoreListing.define_singleton_method(:stage_play_listing) { |_metadata, _screenshots, dir| File.join(dir, 'images') }
  lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'),
    sh: ->(*) {}, google_play_track_version_codes: ->(**) { [12, 13] }, upload_to_play_store: ->(**) {})
  lanes.run_lane(:android, :listing)
  results[:listing] = { uploads: lanes.calls_to(:upload_to_play_store) }

  paths, store_calls = [], []
  expectations = []
  Readiness.define_singleton_method(:android_artifact) do |report, artifact, expected, bundletool:|
    expectations << expected
    paths << bundletool
    report.add('fixture.inspected', 'verified', 'Artifact inspection called.')
  end
  Readiness.define_singleton_method(:android_store) do |report, **options|
    store_calls << options[:track]
    results[:store_options] = options.reject { |name, _| name == :key_path }
    report.add('fixture.store', 'verified', 'Store inspection called.')
  end
  artifact = File.join(dir, 'upload_release.aab')
  output = File.join(dir, 'report.json')
  lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'), {})
  ENV['BUNDLETOOL_JAR'] = 'tools/from-env.jar'
  lanes.run_lane(:android, :readiness, artifact: artifact, output: output, bundletool: 'tools/explicit.jar', store: false)
  results[:offline] = JSON.parse(File.read(output))
  results[:offline_store_calls] = store_calls.dup
  File.delete(output)
  begin
    lanes.run_lane(:android, :readiness, artifact: artifact, output: output, store: false, strict: true)
  rescue UserError
    results[:strict_report] = JSON.parse(File.read(output))
  end
  lanes.run_lane(:android, :readiness, artifact: artifact, output: output, track: 'beta')
  lanes.run_lane(:android, :readiness, artifact: artifact, output: output, store: false, evidence: 'local/manifest.json')
  results[:evidence_calls] = evidence_calls
  results[:store_calls] = store_calls
  results[:tool_paths] = paths
  begin
    lanes.run_lane(:android, :readiness, artifact: artifact, output: output, track: 'unknown')
  rescue UserError => error
    results[:track_error] = error.message
  end
  results[:inspection_count] = paths.size
  results[:expectations] = expectations.uniq
end
puts JSON.generate(results)
`;
const child = Bun.spawnSync(["ruby", "-I", resolve(import.meta.dir, "support"), "-e", script, root], { stdout: "pipe", stderr: "pipe" });
if (child.exitCode !== 0) throw new Error(child.stderr.toString());
const result = JSON.parse(child.stdout.toString());
const status = (report: { checks: { id: string; status: string }[] }, id: string) => report.checks.find((check) => check.id === id)?.status;

describe("Android release and readiness lanes", () => {
  test("builds with the requested build number and upload key, records provenance, then uploads only from upload_release", () => {
    for (const lane of ["build_release", "upload_release", "upload_release_beta"]) {
      const run = result[lane];
      expect(run.gradle).toHaveLength(1);
      expect(run.gradle[0].task).toBe("bundleRelease");
      expect(run.gradle[0].properties.ncUploadKeystore).toBe(result.keystore);
      expect(run.required).toEqual(["ANDROID_KEYSTORE_STORE_PASS", "ANDROID_KEYSTORE_KEY_PASS"]);
      expect(run.receipt.sha256).toBe(run.expected_hash);
      expect(run.receipt.source).toEqual({ commit: "a".repeat(40), dirty: false });
    }
    const secrets = ["ANDROID_KEYSTORE_STORE_PASS", "ANDROID_KEYSTORE_KEY_PASS"];
    expect(result.build_release.events).toEqual([secrets, "wrapper", "build"]);
    expect(result.build_release.uploads).toEqual([]);
    expect(result.build_release.returned_artifact).toBe(true);
    expect(result.build_release.lookups).toEqual([]);
    expect(result.build_release.gradle[0].properties.ncVersionCode).toBe(42);
    expect(result.upload_release.events).toEqual([secrets, "wrapper", "build", "upload"]);
    expect(result.upload_release.lookups.map((call: { track: string }) => call.track)).toEqual(["production", "beta", "alpha", "internal"]);
    expect(result.upload_release.gradle[0].properties.ncVersionCode).toBe(14);
    expect(result.upload_release.uploads).toEqual([expect.objectContaining({ package_name: "net.a2f0.nc", track: "internal", release_status: "draft", changes_not_sent_for_review: true, skip_upload_metadata: true, aab: expect.stringContaining("upload_release.aab") })]);
    expect(result.upload_release_beta.events).toEqual([secrets, "wrapper", "build", "upload"]);
    expect(result.upload_release_beta.gradle[0].properties.ncVersionCode).toBe(14);
    expect(result.upload_release_beta.uploads).toEqual([expect.objectContaining({ track: "beta", release_status: "completed", changes_not_sent_for_review: false, skip_upload_metadata: true, aab: expect.stringContaining("upload_release_beta.aab") })]);
  });
  test("rejects an unknown track or the old version_code: option before building", () => {
    expect(result.bad_track).toBe('Unsupported Play track "qa"; use one of production, beta, alpha, internal');
    expect(result.renamed_option).toBe("version_code: is now build_number:");
  });
  test("promote_release promotes the open testing release without building or uploading anything else", () => {
    const promotion = {
      package_name: "net.a2f0.nc", track: "beta", track_promote_to: "production", track_promote_release_status: "completed",
      skip_upload_apk: true, skip_upload_aab: true, skip_upload_metadata: true,
      skip_upload_changelogs: true, skip_upload_images: true, skip_upload_screenshots: true,
    };
    expect(result.promote_release_0.gradle).toEqual([]);
    expect(result.promote_release_0.uploads).toEqual([expect.objectContaining(promotion)]);
    expect(result.promote_release_0.uploads[0]).not.toHaveProperty("version_code");
    expect(result.promote_release_0.uploads[0]).not.toHaveProperty("rollout");
    expect(result.promote_release_0.uploads[0]).not.toHaveProperty("changes_not_sent_for_review");
    expect(result.promote_release_1.uploads).toEqual([expect.objectContaining({ ...promotion, version_code: "18", rollout: "0.1" })]);
  });
  test("listing attaches to the newest internal release without sending it for review", () => {
    expect(result.listing.uploads).toEqual([expect.objectContaining({
      package_name: "net.a2f0.nc", track: "internal", version_code: 13, changes_not_sent_for_review: true,
      skip_upload_apk: true, skip_upload_aab: true, skip_upload_changelogs: true,
    })]);
  });
  test("offline and strict modes inspect without store calls, resolving explicit and environment tool paths", () => {
    expect(status(result.offline, "fixture.inspected")).toBe("verified");
    expect(status(result.offline, "store.android")).toBe("unverified");
    expect(result.offline_store_calls).toEqual([]);
    expect(result.strict_report.result).toBe("incomplete");
    expect(result.tool_paths).toEqual([resolve(root, "tools/explicit.jar"), ...Array(3).fill(resolve(root, "tools/from-env.jar"))]);
    expect(status(result.offline, "evidence.android_video")).toBe("unverified");
    expect(result.evidence_calls).toEqual([
      { online: false, manifest_path: null }, { online: false, manifest_path: null },
      { online: true, manifest_path: null }, { online: false, manifest_path: resolve(root, "local/manifest.json") },
    ]);
  });
  test("forwards the requested track and rejects unsupported tracks before inspecting", () => {
    expect(result.store_calls).toEqual(["beta"]);
    expect(result.store_options).toEqual({
      package: "net.a2f0.nc", track: "beta",
      listing: { locales: ["de-DE", "en-US", "es-419", "es-ES"], screenshot_locale: "en-US" },
    });
    expect(result.track_error).toBe('Unsupported Play track "unknown"; use one of production, beta, alpha, internal');
    expect(result.inspection_count).toBe(4);
  });
  test("expects the offline app's permissions and a minified bundle", () => {
    expect(result.expectations).toEqual([{
      identifier: "net.a2f0.nc",
      permissions: [
        "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
        "android.permission.WAKE_LOCK", "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.RECEIVE_BOOT_COMPLETED", "net.a2f0.nc.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
      ],
      minified: true,
    }]);
    expect(result.expectations[0].permissions).not.toContain("android.permission.INTERNET");
  });
});
