import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const script = String.raw`
require 'tmpdir'
require 'json'
require 'ostruct'
require File.join(ARGV[0], 'fastlane/lib/readiness_artifacts')
require File.join(ARGV[0], 'fastlane/lib/readiness_stores')
require File.join(ARGV[0], 'fastlane/test/support/fake_fastlane')

def Readiness.source(_root) = { 'commit' => 'a' * 40, 'dirty' => false }
results = {}
Dir.mktmpdir do |dir|
  artifact = File.join(dir, 'candidate.ipa')
  File.write(artifact, 'candidate bytes')
  report = -> { Readiness::Report.new('ios', artifact, dir) }
  results[:missing_receipt] = report.call.result
  Readiness.record_build(artifact, Readiness.source(dir))
  good = report.call
  results[:good_receipt] = good.result
  Readiness.record_build(artifact, { 'commit' => 'b' * 40, 'dirty' => false }, root: dir)
  results[:source_changed] = report.call.data[:checks].find { |c| c[:id] == 'artifact.clean_source' }[:status]
  Readiness.record_build(artifact, Readiness.source(dir))
  Readiness.manual_checks(good)
  results[:manual_remains_unknown] = good.result
  output = File.join(dir, 'private', 'report.json')
  good.write(output)
  results[:private_mode] = File.stat(output).mode & 0777
  File.write(artifact, 'tampered bytes')
  results[:tampered] = report.call.result
  File.write("#{artifact}.build.json", 'not json')
  results[:bad_receipt] = report.call.result
  File.delete(artifact)
  results[:missing_artifact] = report.call.result
  failure = report.call
  failure.attempt('store') { raise 'secret-contact@example.com token-secret' }
  results[:redacted] = JSON.generate(failure.data)

  lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'), {})
  # Offline readiness must not sign, build, authenticate, upload, or submit.
  lanes.run_lane(:ios, :readiness, artifact: artifact, output: output, store: false)
  results[:offline_lane] = JSON.parse(File.read(output))['result']
  begin
    lanes.run_lane(:ios, :readiness, artifact: artifact, output: output, store: false, strict: true)
  rescue UserError
    results[:strict_rejected] = File.file?(output)
  end
  begin
    lanes.run_lane(:ios, :readiness, artifact: artifact, output: artifact, store: false)
  rescue UserError
    results[:overwrite_rejected] = true
  end
end


# Real ZIP extraction catches library API changes (including absolute destination handling).
require 'zip'
Dir.mktmpdir do |dir|
  zip_path = File.join(dir, 'fixture.ipa')
  Zip::File.open(zip_path, create: true) { |zip| zip.get_output_stream('Payload/App.app/Info.plist') { |io| io.write('fixture') } }
  destination = File.join(dir, 'unpacked')
  Dir.mkdir(destination)
  Readiness.unpack(zip_path, destination)
  results[:unpacked] = File.read(File.join(destination, 'Payload/App.app/Info.plist'))
  unsafe = File.join(dir, 'unsafe.ipa')
  Zip::File.open(unsafe, create: true) { |zip| zip.get_output_stream('../escaped') { |io| io.write('no') } }
  begin
    Readiness.unpack(unsafe, destination)
  rescue RuntimeError
    results[:unsafe_rejected] = !File.exist?(File.join(dir, 'escaped'))
  end
end

module Spaceship
  module ConnectAPI
    module Platform
      IOS = 'IOS'
    end
    class App
      def self.find(_id)
        app = OpenStruct.new(id: 'APP')
        app.define_singleton_method(:get_app_store_versions) { |**| [OpenStruct.new(build: nil, fetch_app_store_review_detail: nil, get_app_store_version_localizations: [])] }
        app
      end
    end
    class Build
      def self.all(**options)
        # Deliberately return the wrong version as well; never accept it as the candidate.
        [OpenStruct.new(version: '99', app_version: '0.9', processing_state: 'VALID', id: 'old')]
      end
    end
  end
end
Dir.mktmpdir do |dir|
  artifact = File.join(dir, 'candidate.ipa')
  File.write(artifact, 'fixture')
  report = Readiness::Report.new('ios', artifact, dir)
  report.data[:artifact].merge!(version: '1.0', build_number: '12')
  Readiness.ios_store(report, locales: ['en-US'])
  results[:wrong_store_candidate] = report.data[:checks].find { |c| c[:id] == 'store.processed_build' }[:status]
  results[:missing_contact] = report.data[:checks].find { |c| c[:id] == 'store.review_contact' }[:status]
end

now = 0
calls = 0
processing = OpenStruct.new(processing_state: 'PROCESSING')
result = Readiness.wait_for_build(timeout: 20, clock: -> { now }, sleeper: ->(n) { now += n }) { calls += 1; processing }
results[:timeout] = [now, calls, result.processing_state]
now = 0
calls = 0
result = Readiness.wait_for_build(timeout: 20, clock: -> { now }, sleeper: ->(n) { now += n }) do
  calls += 1
  OpenStruct.new(processing_state: calls == 1 ? 'PROCESSING' : 'INVALID')
end
results[:terminal] = [now, calls, result.processing_state]

module Google
  module Apis
    module AndroidpublisherV3
      class AppEdit; end
    end
  end
end
service = Object.new
events = []
service.define_singleton_method(:insert_edit) { |*| events << 'insert'; OpenStruct.new(id: 'temporary') }
service.define_singleton_method(:delete_edit) { |*| events << 'delete' }
begin
  Readiness.with_play_edit(service, 'net.a2f0.nc') { events << 'read'; raise 'read failed' }
rescue RuntimeError
end
results[:play_cleanup] = events

# Exercise verdicts with actual ZIP entries and fake external verification commands.
original_command = Readiness.method(:command)
Dir.mktmpdir do |dir|
  artifact = File.join(dir, 'candidate.aab')
  Zip::File.open(artifact, create: true) do |zip|
    zip.get_output_stream('BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map') { |io| io.write('mapping') }
    zip.get_output_stream('base/lib/arm64-v8a/libfixture.so') { |io| io.write('fixture') }
  end
  manifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="net.a2f0.nc" android:versionName="1.0" android:versionCode="14"><uses-sdk android:targetSdkVersion="36"/><application android:debuggable="false"/></manifest>'
  mode = :good
  Readiness.define_singleton_method(:command) do |*args|
    if args.include?('manifest')
      raise Errno::ENOENT if mode == :missing_tool
      mode == :bad_manifest ? manifest.sub('debuggable="false"', 'debuggable="true"').sub('<application', '<uses-permission android:name="android.permission.INTERNET"/><application') : manifest
    elsif args.include?('validate')
      raise Readiness::CommandError, 'bundletool failed' if mode == :invalid_bundle
      ''
    else
      raise Readiness::CommandError, 'jarsigner failed' if mode == :bad_signature
      mode == :unsigned ? 'jar verified. This jar contains unsigned entries' : 'jar verified.'
    end
  end
  %i[good bad_manifest invalid_bundle bad_signature unsigned missing_tool].each do |scenario|
    mode = scenario
    report = Readiness::Report.new('android', artifact, dir)
    Readiness.android_artifact(report, artifact)
    results["android_#{scenario}"] = report.data
  end
  empty = File.join(dir, 'empty.aab')
  Zip::File.open(empty, create: true) { |zip| zip.get_output_stream('base/manifest.xml') { |io| io.write('fixture') } }
  mode = :good
  report = Readiness::Report.new('android', empty, dir)
  Readiness.android_artifact(report, empty)
  results[:android_no_mapping] = report.data

  service = Object.new
  track_number, release_status, hash, listing_present, screenshots = '14', 'completed', Digest::SHA256.file(artifact).hexdigest, true, ['image']
  events = []
  service.define_singleton_method(:insert_edit) { |*| events << 'insert'; OpenStruct.new(id: 'temporary') }
  service.define_singleton_method(:delete_edit) { |*| events << 'delete' }
  service.define_singleton_method(:get_edit_track) { |*| OpenStruct.new(releases: [OpenStruct.new(version_codes: [track_number], status: release_status)]) }
  service.define_singleton_method(:list_edit_bundles) { |*| OpenStruct.new(bundles: [OpenStruct.new(version_code: 14, sha256: hash)]) }
  service.define_singleton_method(:list_edit_listings) { |*| OpenStruct.new(listings: listing_present ? [OpenStruct.new(language: 'en-US', title: 'Title', short_description: 'Short', full_description: 'Full')] : []) }
  service.define_singleton_method(:list_edit_images) { |*| OpenStruct.new(images: screenshots) }
  audit = lambda do
    report = Readiness::Report.new('android', artifact, dir)
    report.data[:artifact][:build_number] = '14'
    Readiness.android_store_records(report, service: service, locales: ['en-US'], track: 'internal')
    report.data
  end
  results[:play_good] = audit.call
  track_number = '13'
  results[:play_wrong_code] = audit.call
  track_number, release_status = '14', 'draft'
  results[:play_draft] = audit.call
  release_status, hash, listing_present = 'completed', 'mismatching hash', false
  results[:play_bad_listing_hash] = audit.call
  listing_present, screenshots = true, []
  results[:play_no_screenshots] = audit.call
  results[:play_audit_cleanup] = events
  report = Readiness::Report.new('android', artifact, dir)
  Readiness.android_store(report, key_path: 'must-not-open', locales: ['en-US'])
  results[:play_unknown_code] = report.data
end
Readiness.define_singleton_method(:command, original_command)
puts JSON.generate(results)
`;

const child = Bun.spawnSync(["bundle", "exec", "ruby", "-I", resolve(import.meta.dir, "support"), "-e", script, root], {
  stdout: "pipe", stderr: "pipe",
});
if (child.exitCode !== 0) throw new Error(child.stderr.toString());
const result = JSON.parse(child.stdout.toString());

describe("artifact-bound readiness reports", () => {
  test("does not infer provenance from the current checkout", () => {
    expect(result.missing_receipt).toBe("incomplete");
    expect(result.good_receipt).toBe("ready_within_tested_scope");
    expect(result.source_changed).toBe("failed");
    expect(result.tampered).toBe("not_ready");
    expect(result.bad_receipt).toBe("incomplete");
    expect(result.missing_artifact).toBe("not_ready");
  });
  test("keeps manual coverage unknown and private diagnostics redacted", () => {
    expect(result.manual_remains_unknown).toBe("incomplete");
    expect(result.private_mode).toBe(0o600);
    expect(result.redacted).not.toContain("secret-contact");
    expect(result.redacted).not.toContain("token-secret");
  });
  test("offline lanes report without store or build actions; strict mode fails after saving evidence", () => {
    expect(result.offline_lane).toBe("not_ready");
    expect(result.strict_rejected).toBe(true);
    expect(result.overwrite_rejected).toBe(true);
  });
  test("processing wait is bounded and stops on a rejected build", () => {
    expect(result.timeout).toEqual([20, 3, "PROCESSING"]);
    expect(result.terminal).toEqual([15, 2, "INVALID"]);
  });
  test("extracts into the temporary directory and rejects traversal", () => {
    expect(result.unpacked).toBe("fixture");
    expect(result.unsafe_rejected).toBe(true);
  });
  test("never uses an unrelated processed build or treats missing contacts as complete", () => {
    expect(result.wrong_store_candidate).toBe("unverified");
    expect(result.missing_contact).toBe("failed");
  });
  test("always deletes the temporary Play edit, including on query failure", () => {
    expect(result.play_cleanup).toEqual(["insert", "read", "delete"]);
  });
});

const status = (report: { checks: { id: string; status: string }[] }, id: string) =>
  report.checks.find((check) => check.id === id)?.status;

describe("Android readiness verdicts", () => {
  test("checks manifest, signature, mapping, and native inventory", () => {
    for (const id of ["artifact.identifier", "artifact.release", "artifact.offline_permissions", "artifact.bundle_structure", "artifact.signature", "artifact.r8_mapping"]) {
      expect(status(result.android_good, id)).toBe("verified");
    }
    expect(result.android_good.artifact.build_number).toBe("14");
    expect(result.android_good.artifact.native_libraries).toEqual(["base/lib/arm64-v8a/libfixture.so"]);
    expect(status(result.android_good, "artifact.native_page_size")).toBe("unverified");
    expect(status(result.android_bad_manifest, "artifact.release")).toBe("failed");
    expect(status(result.android_bad_manifest, "artifact.offline_permissions")).toBe("failed");
    expect(status(result.android_no_mapping, "artifact.r8_mapping")).toBe("failed");
    expect(status(result.android_no_mapping, "artifact.native_page_size")).toBe("not_applicable");
  });
  test("distinguishes rejected artifacts from missing tools and continues independent checks", () => {
    expect(status(result.android_invalid_bundle, "artifact.bundle_structure")).toBe("failed");
    expect(status(result.android_invalid_bundle, "artifact.signature")).toBe("verified");
    expect(status(result.android_bad_signature, "artifact.signature")).toBe("failed");
    expect(status(result.android_bad_signature, "artifact.r8_mapping")).toBe("verified");
    expect(status(result.android_unsigned, "artifact.signature")).toBe("failed");
    expect(status(result.android_missing_tool, "artifact.android")).toBe("unverified");
    expect(status(result.play_unknown_code, "store.candidate")).toBe("unverified");
    expect(status(result.play_unknown_code, "store.track_candidate")).toBeUndefined();
  });
  test("requires the exact active Play candidate, bytes, listing, and screenshots", () => {
    for (const id of ["store.track_candidate", "store.bundle_hash", "store.listing.en-US", "store.screenshots.en-US"]) {
      expect(status(result.play_good, id)).toBe("verified");
    }
    expect(status(result.play_wrong_code, "store.track_candidate")).toBe("failed");
    expect(status(result.play_draft, "store.track_candidate")).toBe("failed");
    expect(status(result.play_bad_listing_hash, "store.bundle_hash")).toBe("failed");
    expect(status(result.play_bad_listing_hash, "store.listing.en-US")).toBe("failed");
    expect(status(result.play_bad_listing_hash, "store.screenshots.en-US")).toBe("failed");
    expect(status(result.play_no_screenshots, "store.screenshots.en-US")).toBe("failed");
    expect(result.play_audit_cleanup).toEqual(Array.from({ length: 5 }, () => ["insert", "delete"]).flat());
  });
});
