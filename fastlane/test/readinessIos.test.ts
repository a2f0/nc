import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

// The readiness libraries' own verdicts are in readiness.test.ts, shared with
// balebase; these run nc's iOS lane and its expectations.
const root = resolve(import.meta.dir, "../..");
const script = String.raw`
require 'tmpdir'
require 'json'
require 'zip'
require 'cfpropertylist'
require File.join(ARGV[0], 'fastlane/lib/readiness_artifacts')
require File.join(ARGV[0], 'fastlane/lib/readiness_stores')
require File.join(ARGV[0], 'fastlane/test/support/fake_fastlane')
def Readiness.source(_root) = { 'commit' => 'a' * 40, 'dirty' => false }
def xml(value)
  list = CFPropertyList::List.new
  list.value = CFPropertyList.guess(value)
  list.to_str(CFPropertyList::List::FORMAT_XML)
end
results = {}

# A real nc-shaped IPA, inspected offline through the lane and nc's expectations.
original_command = Readiness.method(:command)
Readiness.define_singleton_method(:command) do |*args|
  if args.first == 'codesign'
    next '' if args.include?('--verify')
    id = args.last.end_with?('.appex') ? 'net.a2f0.nc.widget' : 'net.a2f0.nc'
    xml('get-task-allow' => false, 'application-identifier' => "TEAM.#{id}", 'com.apple.security.application-groups' => ['group.net.a2f0.nc'])
  elsif args.first == 'security'
    xml('ExpirationDate' => Time.now + 3600)
  else
    raise "Unexpected command: #{args.first}"
  end
end
Dir.mktmpdir do |dir|
  artifact = File.join(dir, 'candidate.ipa')
  Zip::File.open(artifact, create: true) do |zip|
    ['Payload/App.app', 'Payload/App.app/PlugIns/Widget.appex'].each do |target|
      id = target.end_with?('.appex') ? 'net.a2f0.nc.widget' : 'net.a2f0.nc'
      info = { 'CFBundleIdentifier' => id, 'CFBundleShortVersionString' => '1.0', 'CFBundleVersion' => '12', 'DTSDKName' => 'iphoneos26.0' }
      privacy = { 'NSPrivacyTracking' => false, 'NSPrivacyCollectedDataTypes' => [],
                  'NSPrivacyAccessedAPITypes' => [{ 'NSPrivacyAccessedAPIType' => 'NSPrivacyAccessedAPICategoryUserDefaults', 'NSPrivacyAccessedAPITypeReasons' => ['CA92.1', '1C8F.1'] }] }
      { 'Info.plist' => xml(info), 'PrivacyInfo.xcprivacy' => xml(privacy), 'embedded.mobileprovision' => 'signed fixture' }.each do |name, contents|
        zip.get_output_stream("#{target}/#{name}") { |io| io.write(contents) }
      end
    end
  end
  Readiness.record_build(artifact, Readiness.source(dir))
  lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'), {})
  output = File.join(dir, 'offline.json')
  # Offline readiness must not sign, build, authenticate, upload, or submit.
  lanes.run_lane(:ios, :readiness, artifact: artifact, output: output, store: false)
  results[:offline] = JSON.parse(File.read(output))
  File.delete(output)
  begin
    lanes.run_lane(:ios, :readiness, artifact: artifact, output: output, store: false, strict: true)
  rescue UserError
    results[:strict_written] = JSON.parse(File.read(output))['result']
  end
  begin
    lanes.run_lane(:ios, :readiness, artifact: artifact, output: artifact, store: false)
  rescue UserError
    results[:overwrite_rejected] = true
  end
  results[:default_output] = lanes.readiness_options({}, 'ios', artifact).last
  original_source = Readiness.method(:source)
  Readiness.define_singleton_method(:source) { |_| raise Errno::ENOENT }
  begin
    lanes.release_source
  rescue UserError => error
    results[:build_git_error] = error.message
  end
  Readiness.define_singleton_method(:source, original_source)
  begin
    lanes.run_lane(:ios, :readiness, wait_timeout: 'abc')
  rescue UserError => error
    results[:timeout_error] = error.message
  end
end
Readiness.define_singleton_method(:command, original_command)

module FastlaneCore
  module Interface
    class FastlaneError < StandardError; end
  end
end
Dir.mktmpdir do |dir|
  artifact = File.join(dir, 'candidate.ipa')
  File.write(artifact, 'fixture')
  stores = []
  Readiness.define_singleton_method(:ios_artifact) { |report, _, _| report.data[:artifact].merge!(version: '1.0', build_number: '12') }
  Readiness.define_singleton_method(:ios_store) do |report, **options|
    stores << options
    report.add('store.processed_build', 'verified', 'Store inspection called.')
  end
  %i[pass rejected error skipped].each do |mode|
    lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'),
      app_store_connect_api_key: ->(**) { 'fixture-key' },
      precheck: ->(**) {
        raise FastlaneCore::Interface::FastlaneError, 'found one or more potential problems that must be addressed' if mode == :rejected
        raise FastlaneCore::Interface::FastlaneError, 'private authentication diagnostic' if mode == :error
        true
      })
    lanes.stub_method(:load_store_secrets) { |_| nil }
    lanes.stub_method(:app_store_connect_api_key_options) { {} }
    output = File.join(dir, "#{mode}.json")
    lanes.run_lane(:ios, :readiness, artifact: artifact, output: output, precheck: mode != :skipped)
    results["precheck_#{mode}"] = JSON.parse(File.read(output))
    results["precheck_calls_#{mode}"] = lanes.calls_to(:precheck).length
  end
  results[:store_options] = stores.first
end
puts JSON.generate(results)
`;
const child = Bun.spawnSync(["bundle", "exec", "ruby", "-I", resolve(import.meta.dir, "support"), "-e", script, root], { stdout: "pipe", stderr: "pipe" });
if (child.exitCode !== 0) throw new Error(child.stderr.toString());
const result = JSON.parse(child.stdout.toString());
const status = (report: { checks: { id: string; status: string }[] }, id: string) => report.checks.find((check) => check.id === id)?.status;

describe("iOS readiness lane", () => {
  test("inspects a real app-and-widget IPA offline against nc's expectations", () => {
    for (const id of ["artifact.identifier", "artifact.targets"]) expect(status(result.offline, id)).toBe("verified");
    for (const id of ["net.a2f0.nc", "net.a2f0.nc.widget"]) {
      for (const check of ["signature", "app_group", "distribution", "privacy"]) expect(status(result.offline, `${check}.${id}`)).toBe("verified");
    }
    expect(status(result.offline, "store.ios")).toBe("unverified");
    expect(result.offline.result).toBe("incomplete");
  });
  test("writes a new strict report before raising and protects the artifact", () => {
    expect(result.strict_written).toBe("incomplete");
    expect(result.overwrite_rejected).toBe(true);
    expect(result.default_output).toBe(resolve(root, ".readiness/production/ios.json"));
  });
  test("gives actionable errors for missing git and invalid lane input", () => {
    expect(result.build_git_error).toContain("install git");
    expect(result.timeout_error).toBe("wait_timeout must be between 0 and 1800 seconds");
  });
});

test("iOS store lane distinguishes precheck rejection, setup errors, and an explicitly skipped check", () => {
  expect(result.store_options).toEqual({
    app_identifier: "net.a2f0.nc",
    listing: { locales: ["de-DE", "en-US", "es-ES", "es-MX"], screenshot_locale: "en-US" },
    timeout: 0,
  });
  expect(status(result.precheck_pass, "store.precheck")).toBe("verified");
  expect(status(result.precheck_pass, "store.processed_build")).toBe("verified");
  expect(status(result.precheck_rejected, "store.precheck")).toBe("failed");
  expect(status(result.precheck_error, "store.precheck")).toBe("unverified");
  expect(JSON.stringify(result.precheck_error)).not.toContain("private authentication diagnostic");
  expect(status(result.precheck_skipped, "store.precheck")).toBe("unverified");
  expect(result.precheck_calls_skipped).toBe(0);
});
