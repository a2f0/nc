# frozen_string_literal: true

require_relative 'readiness'
require 'tmpdir'

module Readiness
  # Reject traversal and symlinks before extracting an IPA for codesign inspection.
  def self.unpack(artifact, destination)
    require 'zip'
    Zip::File.open(artifact) do |zip|
      zip.each do |entry|
        path = File.expand_path(entry.name, destination)
        raise 'Unsafe archive entry' unless path.start_with?(destination + '/') && !entry.symlink?
        FileUtils.mkdir_p(File.dirname(path))
        entry.extract(entry.name, destination_directory: destination)
      end
    end
  end

  def self.plist(path)
    require 'cfpropertylist'
    CFPropertyList.native_types(CFPropertyList::List.new(file: path).value)
  end

  def self.ios_artifact(report, artifact)
    return unless File.file?(artifact)
    report.attempt('artifact.ios') do
      Dir.mktmpdir('nc-readiness-') do |dir|
        unpack(artifact, dir)
        apps = Dir.glob(File.join(dir, 'Payload', '*.app'))
        raise 'Expected one application' unless apps.length == 1
        app = apps.first
        info = plist(File.join(app, 'Info.plist'))
        report.data[:artifact][:version] = info.fetch('CFBundleShortVersionString')
        report.data[:artifact][:build_number] = info.fetch('CFBundleVersion')
        report.data[:artifact][:sdk] = info['DTSDKName']
        report.data[:artifact][:minimum_os] = info['MinimumOSVersion']
        report.check('artifact.identifier', info['CFBundleIdentifier'] == 'net.a2f0.nc', 'Expected net.a2f0.nc.')
        targets = [app] + Dir.glob(File.join(app, 'PlugIns', '*.appex'))
        report.check('artifact.widget', targets.any? { |target| plist(File.join(target, 'Info.plist'))['CFBundleIdentifier'] == 'net.a2f0.nc.widget' }, 'Expected the widget extension in the IPA.')
        targets.each do |target|
          id = plist(File.join(target, 'Info.plist')).fetch('CFBundleIdentifier')
          report.attempt("signature.#{id}") do
            command('codesign', '--verify', '--deep', '--strict', target)
            entitlements = command('codesign', '--display', '--entitlements', ':-', target)
            path = File.join(dir, 'entitlements.plist')
            File.write(path, entitlements)
            values = plist(path)
            report.check("signature.#{id}", values['get-task-allow'] != true &&
                         values.fetch('application-identifier', '').end_with?(".#{id}"), 'Signature verifies and disallows debugging.')
            report.check("app_group.#{id}", values.fetch('com.apple.security.application-groups', []).include?('group.net.a2f0.nc'), 'Expected shared app group entitlement.')
          end
          report.attempt("distribution.#{id}") do
            profile = File.join(target, 'embedded.mobileprovision')
            decoded = File.join(dir, 'profile.plist')
            File.write(decoded, command('security', 'cms', '-D', '-i', profile))
            profile_values = plist(decoded)
            report.check("distribution.#{id}", !profile_values.key?('ProvisionedDevices') && profile_values['ProvisionsAllDevices'] != true &&
                         Time.parse(profile_values.fetch('ExpirationDate').to_s) > Time.now,
                         'Embedded profile must be for App Store distribution, not development/ad hoc/enterprise.')
          end
          report.attempt("privacy.#{id}") do
            privacy = plist(File.join(target, 'PrivacyInfo.xcprivacy'))
            reasons = privacy.fetch('NSPrivacyAccessedAPITypes', []).select { |api| api['NSPrivacyAccessedAPIType'] == 'NSPrivacyAccessedAPICategoryUserDefaults' }
            report.check("privacy.#{id}", privacy['NSPrivacyTracking'] == false && privacy['NSPrivacyCollectedDataTypes'] == [] &&
                         reasons.any? { |api| %w[CA92.1 1C8F.1].all? { |reason| api.fetch('NSPrivacyAccessedAPITypeReasons', []).include?(reason) } },
                         'Packaged app/widget privacy manifest must match the current no-collection and UserDefaults declarations.')
          end
        end
      end
    end
  end

  def self.android_artifact(report, artifact, bundletool: nil)
    return unless File.file?(artifact)
    report.attempt('artifact.android') do
      require 'rexml/document'
      require 'zip'
      tool = bundletool ? ['java', '-jar', File.expand_path(bundletool)] : ['bundletool']
      xml = command(*tool, 'dump', 'manifest', "--bundle=#{artifact}", '--module=base')
      doc = REXML::Document.new(xml)
      manifest = doc.root
      app = manifest.elements['application']
      sdk = manifest.elements['uses-sdk']
      report.data[:artifact].merge!(version: manifest.attributes['android:versionName'], build_number: manifest.attributes['android:versionCode'],
                                    target_sdk: sdk&.attributes&.[]('android:targetSdkVersion'), minimum_sdk: sdk&.attributes&.[]('android:minSdkVersion'))
      report.check('artifact.identifier', manifest.attributes['package'] == 'net.a2f0.nc', 'Expected net.a2f0.nc.')
      report.check('artifact.release', app && app.attributes['android:debuggable'] != 'true', 'Release manifest must disallow debugging.')
      permissions = manifest.get_elements('uses-permission').map { |p| p.attributes['android:name'] }
      report.data[:artifact][:permissions] = permissions
      report.check('artifact.offline_permissions', !permissions.include?('android.permission.INTERNET'), 'Native playback/history should not request INTERNET.')
      command(*tool, 'validate', "--bundle=#{artifact}")
      report.add('artifact.bundle_structure', 'verified', 'bundletool validation passed.')
      signature = command('jarsigner', '-verify', artifact)
      report.check('artifact.signature', signature.include?('jar verified.'), 'AAB JAR signature must verify. This does not establish the Play upload-key identity.')
      report.add('artifact.upload_key_identity', 'unverified', 'Compare signer certificate with the expected Play upload certificate.')
      Zip::File.open(artifact) do |zip|
        report.check('artifact.r8_mapping', zip.find_entry('BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map') != nil, 'Expected the release obfuscation mapping in the AAB.')
        native = zip.entries.map(&:name).grep(%r{^[^/]+/lib/.*\.so$})
        report.data[:artifact][:native_libraries] = native
        report.add('artifact.native_page_size', native.empty? ? 'not_applicable' : 'unverified', native.empty? ? 'No native libraries.' : 'Verify ELF and generated APK 16KB alignment for the listed native libraries.')
      end
    end
  end
end
