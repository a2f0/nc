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
