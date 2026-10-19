import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const script = String.raw`
require 'tmpdir'
require 'json'
require 'ostruct'
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
Dir.mktmpdir do |dir|
  mode = :good
  Readiness.define_singleton_method(:command) do |*args|
    if args.first == 'codesign'
      raise Errno::ENOENT if mode == :missing_codesign
      raise Readiness::CommandError, 'codesign failed' if mode == :bad_signature && args.include?('--verify')
      next '' if args.include?('--verify')
      id = args.last.end_with?('.appex') ? 'net.a2f0.nc.widget' : 'net.a2f0.nc'
      xml('get-task-allow' => mode == :debuggable, 'application-identifier' => "TEAM.#{id}",
          'com.apple.security.application-groups' => mode == :missing_group ? [] : ['group.net.a2f0.nc'])
    elsif args.first == 'security'
      profile = { 'ExpirationDate' => mode == :expired ? Time.now - 3600 : Time.now + 3600 }
      profile['ProvisionedDevices'] = ['device'] if %i[development ad_hoc].include?(mode)
      profile['Entitlements'] = { 'get-task-allow' => mode == :development }
      profile['ProvisionsAllDevices'] = true if mode == :enterprise
      xml(profile)
    else
      raise "Unexpected command: #{args.first}"
    end
  end
  %i[good development ad_hoc enterprise expired debuggable missing_group bad_privacy missing_codesign bad_signature missing_profile missing_privacy].each do |scenario|
    mode = scenario
    artifact = File.join(dir, "#{mode}.ipa")
    Zip::File.open(artifact, create: true) do |zip|
      ['Payload/App.app', 'Payload/App.app/PlugIns/Widget.appex'].each do |target|
        id = target.end_with?('.appex') ? 'net.a2f0.nc.widget' : 'net.a2f0.nc'
        info = { 'CFBundleIdentifier' => id, 'CFBundleShortVersionString' => '1.0', 'CFBundleVersion' => '12', 'DTSDKName' => 'iphoneos26.0' }
        privacy = { 'NSPrivacyTracking' => mode == :bad_privacy, 'NSPrivacyCollectedDataTypes' => [],
                    'NSPrivacyAccessedAPITypes' => [{ 'NSPrivacyAccessedAPIType' => 'NSPrivacyAccessedAPICategoryUserDefaults', 'NSPrivacyAccessedAPITypeReasons' => ['CA92.1', '1C8F.1'] }] }
        { 'Info.plist' => xml(info), 'PrivacyInfo.xcprivacy' => xml(privacy), 'embedded.mobileprovision' => 'signed fixture' }.each do |name, contents|
          next if (mode == :missing_profile && name == 'embedded.mobileprovision') || (mode == :missing_privacy && name == 'PrivacyInfo.xcprivacy')
          zip.get_output_stream("#{target}/#{name}") { |io| io.write(contents) }
        end
      end
    end
    Readiness.record_build(artifact, Readiness.source(dir))
    report = Readiness::Report.new('ios', artifact, dir)
    Readiness.ios_artifact(report, artifact)
    results[mode] = report.data
    if mode == :good
      # A real IPA is inspected offline, and strict writes a fresh report before failing.
      lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'), {})
      output = File.join(dir, 'offline.json')
      lanes.run_lane(:ios, :readiness, artifact: artifact, output: output, store: false)
      results[:offline] = JSON.parse(File.read(output))
      File.delete(output)
      begin
        lanes.run_lane(:ios, :readiness, artifact: artifact, output: output, store: false, strict: true)
      rescue UserError
        results[:strict_written] = JSON.parse(File.read(output))['result']
      end
    end
  end
end

module Spaceship
  module ConnectAPI
    module Platform
      IOS = 'IOS'
    end
    class App
      class << self
        attr_accessor :current
        def find(_id) = current
      end
    end
    class Build
      class << self
        attr_accessor :current
        def all(**) = [current]
      end
    end
  end
end
Dir.mktmpdir do |dir|
  artifact = File.join(dir, 'fixture.ipa')
  File.write(artifact, 'fixture')
  build = OpenStruct.new(version: '12', app_version: '1.0', processing_state: 'VALID', expired: false, id: 'candidate')
  Spaceship::ConnectAPI::Build.current = build
  %i[good wrong_selected reserved_phone missing_ipad no_review].each do |mode|
    shot = ->(state) { OpenStruct.new(asset_delivery_state: { 'state' => state }) }
    sets = [OpenStruct.new(screenshot_display_type: 'APP_IPHONE_67', app_screenshots: [shot.call(mode == :reserved_phone ? 'AWAITING_UPLOAD' : 'COMPLETE')])]
    sets << OpenStruct.new(screenshot_display_type: 'APP_IPAD_PRO_3GEN_129', app_screenshots: [shot.call('COMPLETE')]) unless mode == :missing_ipad
    entry = OpenStruct.new(locale: 'en-US', description: 'Description', support_url: 'https://example.test', get_app_screenshot_sets: sets)
    translated = OpenStruct.new(locale: 'de-DE', description: 'Beschreibung', support_url: 'https://example.test')
    translated.define_singleton_method(:get_app_screenshot_sets) { raise 'Only the upload locale needs screenshots' }
    review = OpenStruct.new(contact_first_name: 'First', contact_last_name: 'Last', contact_phone: '123', contact_email: 'private@example.test', notes: 'Offline background audio')
    version = OpenStruct.new(build: mode == :wrong_selected ? OpenStruct.new(id: 'other') : build, get_app_store_version_localizations: [entry, translated])
    version.define_singleton_method(:fetch_app_store_review_detail) { raise 'No data' if mode == :no_review; review }
    app = OpenStruct.new(id: 'app')
    app.define_singleton_method(:get_app_store_versions) { |**| [version] }
    Spaceship::ConnectAPI::App.current = app
    report = Readiness::Report.new('ios', artifact, dir)
    report.data[:artifact].merge!(version: '1.0', build_number: '12')
    Readiness.ios_store(report, locales: ['en-US', 'de-DE'])
    results["store_#{mode}"] = report.data
  end
end
module FastlaneCore
  module Interface
    class FastlaneError < StandardError; end
  end
end
Dir.mktmpdir do |dir|
  artifact = File.join(dir, 'candidate.ipa')
  File.write(artifact, 'fixture')
  Readiness.define_singleton_method(:ios_artifact) { |report, _| report.data[:artifact].merge!(version: '1.0', build_number: '12') }
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
end
puts JSON.generate(results)
`;
const child = Bun.spawnSync(["bundle", "exec", "ruby", "-I", resolve(import.meta.dir, "support"), "-e", script, root], { stdout: "pipe", stderr: "pipe" });
if (child.exitCode !== 0) throw new Error(child.stderr.toString());
const result = JSON.parse(child.stdout.toString());
const status = (report: { checks: { id: string; status: string }[] }, id: string) => report.checks.find((check) => check.id === id)?.status;

describe("iOS readiness verdicts", () => {
  test("verifies real packaged app/widget plists and rejects invalid distribution evidence", () => {
    for (const id of ["net.a2f0.nc", "net.a2f0.nc.widget"]) {
      for (const check of ["signature", "app_group", "distribution", "privacy"]) expect(status(result.good, `${check}.${id}`)).toBe("verified");
      for (const mode of ["development", "ad_hoc", "enterprise", "expired"]) expect(status(result[mode], `distribution.${id}`)).toBe("failed");
      expect(status(result.debuggable, `signature.${id}`)).toBe("failed");
      expect(status(result.missing_group, `app_group.${id}`)).toBe("failed");
      expect(status(result.bad_privacy, `privacy.${id}`)).toBe("failed");
      expect(status(result.missing_profile, `distribution.${id}`)).toBe("failed");
      expect(status(result.missing_privacy, `privacy.${id}`)).toBe("failed");
      expect(status(result.bad_signature, `signature.${id}`)).toBe("failed");
      expect(status(result.missing_codesign, `signature.${id}`)).toBe("unverified");
    }
    expect(result.good.artifact.build_number).toBe("12");
    expect(status(result.good, "artifact.widget")).toBe("verified");
  });
  test("inspects a real IPA offline and writes a new strict report before raising", () => {
    expect(status(result.offline, "signature.net.a2f0.nc")).toBe("verified");
    expect(status(result.offline, "store.ios")).toBe("unverified");
    expect(result.strict_written).toBe("incomplete");
  });
  test("requires the selected exact build and completed iPhone and iPad screenshots", () => {
    for (const id of ["store.processed_build", "store.selected_build", "store.review_contact", "store.review_notes", "store.listing.en-US", "store.screenshots.en-US"]) expect(status(result.store_good, id)).toBe("verified");
    expect(status(result.store_good, "store.listing.de-DE")).toBe("verified");
    expect(status(result.store_good, "store.screenshots.de-DE")).toBeUndefined();
    expect(status(result.store_wrong_selected, "store.selected_build")).toBe("failed");
    expect(status(result.store_reserved_phone, "store.screenshots.en-US")).toBe("failed");
    expect(status(result.store_missing_ipad, "store.screenshots.en-US")).toBe("failed");
    expect(status(result.store_no_review, "store.review_contact")).toBe("failed");
    expect(status(result.store_no_review, "store.review_notes")).toBe("failed");
    expect(status(result.store_no_review, "store.screenshots.en-US")).toBe("verified");
    expect(JSON.stringify(result.store_good)).not.toContain("private@example.test");
  });
});

test("iOS store lane distinguishes precheck rejection, setup errors, and an explicitly skipped check", () => {
  expect(status(result.precheck_pass, "store.precheck")).toBe("verified");
  expect(status(result.precheck_pass, "store.processed_build")).toBe("verified");
  expect(status(result.precheck_rejected, "store.precheck")).toBe("failed");
  expect(status(result.precheck_error, "store.precheck")).toBe("unverified");
  expect(JSON.stringify(result.precheck_error)).not.toContain("private authentication diagnostic");
  expect(status(result.precheck_skipped, "store.precheck")).toBe("unverified");
  expect(result.precheck_calls_skipped).toBe(0);
});
