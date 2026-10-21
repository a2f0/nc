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
  key = File.join(dir, 'fixture.keystore')
  File.write(key, 'not a real key')
  %i[build_release internal beta].each do |lane|
    artifact = File.join(dir, "#{lane}.aab")
    events = []
    lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'),
      sh: ->(*args) { events << 'wrapper' },
      gradle: ->(**) { events << 'build'; File.write(artifact, 'signed fixture') },
      google_play_track_version_codes: ->(**args) { args[:track] == 'internal' ? [13] : [] },
      upload_to_play_store: ->(**args) {
        raise 'missing receipt before upload' unless File.file?("#{args[:aab]}.build.json")
        events << 'upload'
      })
    { ANDROID_KEYSTORE_PATH: key, ANDROID_RELEASE_AAB: artifact }.each do |name, value|
      lanes.singleton_class.send(:remove_const, name)
      lanes.singleton_class.const_set(name, value)
    end
    lanes.stub_method(:load_store_secrets) { |_| nil }
    lanes.stub_method(:required_env) { |_| 'fixture password' }
    options = { build_release: { version_code: '42' }, internal: { release_status: 'draft' }, beta: {} }.fetch(lane)
    returned = lanes.run_lane(:android, lane, options)
    results[lane] = { events: events, gradle: lanes.calls_to(:gradle), uploads: lanes.calls_to(:upload_to_play_store),
      lookups: lanes.calls_to(:google_play_track_version_codes), returned_artifact: returned == artifact,
      receipt: JSON.parse(File.read("#{artifact}.build.json")), expected_hash: Digest::SHA256.file(artifact).hexdigest }
  end

  paths, store_calls = [], []
  Readiness.define_singleton_method(:android_artifact) do |report, artifact, bundletool:|
    paths << bundletool
    report.add('fixture.inspected', 'verified', 'Artifact inspection called.')
  end
  Readiness.define_singleton_method(:android_store) do |report, **options|
    store_calls << options[:track]
    report.add('fixture.store', 'verified', 'Store inspection called.')
  end
  artifact = File.join(dir, 'internal.aab')
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
end
puts JSON.generate(results)
`;
const child = Bun.spawnSync(["ruby", "-I", resolve(import.meta.dir, "support"), "-e", script, root], { stdout: "pipe", stderr: "pipe" });
if (child.exitCode !== 0) throw new Error(child.stderr.toString());
const result = JSON.parse(child.stdout.toString());
const status = (report: { checks: { id: string; status: string }[] }, id: string) => report.checks.find((check) => check.id === id)?.status;

describe("Android release and readiness lanes", () => {
  test("builds with the requested version, records provenance, then uploads only from internal and beta", () => {
    for (const lane of ["build_release", "internal", "beta"]) {
      const run = result[lane];
      expect(run.gradle).toHaveLength(1);
      expect(run.gradle[0].task).toBe("bundleRelease");
      expect(run.receipt.sha256).toBe(run.expected_hash);
      expect(run.receipt.source).toEqual({ commit: "a".repeat(40), dirty: false });
    }
    expect(result.build_release.events).toEqual(["wrapper", "build"]);
    expect(result.build_release.uploads).toEqual([]);
    expect(result.build_release.returned_artifact).toBe(true);
    expect(result.build_release.lookups).toEqual([]);
    expect(result.build_release.gradle[0].properties.ncVersionCode).toBe(42);
    expect(result.internal.events).toEqual(["wrapper", "build", "upload"]);
    expect(result.internal.lookups.map((call: { track: string }) => call.track)).toEqual(["production", "beta", "alpha", "internal"]);
    expect(result.internal.gradle[0].properties.ncVersionCode).toBe(14);
    expect(result.internal.uploads).toEqual([expect.objectContaining({ track: "internal", release_status: "draft", skip_upload_metadata: true, aab: expect.stringContaining("internal.aab") })]);
    expect(result.beta.events).toEqual(["wrapper", "build", "upload"]);
    expect(result.beta.gradle[0].properties.ncVersionCode).toBe(14);
    expect(result.beta.uploads).toEqual([expect.objectContaining({ track: "beta", release_status: "completed", skip_upload_metadata: true, aab: expect.stringContaining("beta.aab") })]);
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
    expect(result.track_error).toBe("Unsupported Play track");
    expect(result.inspection_count).toBe(4);
  });
});
