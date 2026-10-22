# frozen_string_literal: true

require_relative 'readiness'
require 'tmpdir'

# Artifact inspection: what the IPA or AAB itself contains and how it's signed.
module Readiness
  # Reject traversal and symlinks before extracting an IPA for codesign inspection.
  def self.unpack(artifact, destination)
    require 'zip'
    Zip::File.open(artifact) do |zip|
      zip.each do |entry|
        path = File.expand_path(entry.name, destination)
        raise 'Unsafe archive entry' unless path.start_with?("#{destination}/") && !entry.symlink?

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

        IosArtifact.new(report, dir).inspect_app(apps.first)
      end
    end
  end

  def self.android_artifact(report, artifact, bundletool: nil)
    return unless File.file?(artifact)

    android = AndroidArtifact.new(report, artifact)
    report.attempt('artifact.android') { android.inspect_manifest(bundletool) }
    report.attempt('artifact.signature', verification: true) { android.inspect_signature }
    report.add('artifact.upload_key_identity', 'unverified',
               'Compare signer certificate with the expected Play upload certificate.')
    report.attempt('artifact.contents') { android.inspect_contents }
  end

  # Checks an unpacked IPA's app and each of its extensions.
  class IosArtifact
    PRIVACY_REASONS = %w[CA92.1 1C8F.1].freeze

    def initialize(report, dir)
      @report = report
      @dir = dir
    end

    def inspect_app(app)
      info = Readiness.plist(File.join(app, 'Info.plist'))
      record_versions(info)
      @report.check('artifact.identifier', info['CFBundleIdentifier'] == 'net.a2f0.nc', 'Expected net.a2f0.nc.')
      targets = [app] + Dir.glob(File.join(app, 'PlugIns', '*.appex'))
      widget = targets.any? do |target|
        Readiness.plist(File.join(target, 'Info.plist'))['CFBundleIdentifier'] == 'net.a2f0.nc.widget'
      end
      @report.check('artifact.widget', widget, 'Expected the widget extension in the IPA.')
      targets.each { |target| inspect_target(target) }
    end

    private

    def record_versions(info)
      artifact = @report.data[:artifact]
      artifact[:version] = info.fetch('CFBundleShortVersionString')
      artifact[:build_number] = info.fetch('CFBundleVersion')
      artifact[:sdk] = info['DTSDKName']
      artifact[:minimum_os] = info['MinimumOSVersion']
    end

    def inspect_target(target)
      id = Readiness.plist(File.join(target, 'Info.plist')).fetch('CFBundleIdentifier')
      @report.attempt("signature.#{id}", verification: true) { inspect_signature(target, id) }
      @report.attempt("distribution.#{id}") { inspect_distribution(target, id) }
      @report.attempt("privacy.#{id}") { inspect_privacy(target, id) }
    end

    def inspect_signature(target, id)
      Readiness.command('codesign', '--verify', '--deep', '--strict', target)
      values = write_plist('entitlements.plist',
                           Readiness.command('codesign', '--display', '--entitlements', '-', '--xml', target))
      signed = values['get-task-allow'] != true && values.fetch('application-identifier', '').end_with?(".#{id}")
      @report.check("signature.#{id}", signed, 'Signature verifies and disallows debugging.')
      groups = values.fetch('com.apple.security.application-groups', [])
      @report.check("app_group.#{id}", groups.include?('group.net.a2f0.nc'), 'Expected shared app group entitlement.')
    end

    def inspect_distribution(target, id)
      profile = File.join(target, 'embedded.mobileprovision')
      unless File.file?(profile)
        return @report.check("distribution.#{id}", false, 'Packaged target is missing its distribution profile.')
      end

      values = write_plist('profile.plist', Readiness.command('security', 'cms', '-D', '-i', profile))
      @report.check("distribution.#{id}", app_store_profile?(values),
                    'Embedded profile must be for App Store distribution, not development/ad hoc/enterprise.')
    end

    def app_store_profile?(values)
      !values.key?('ProvisionedDevices') && values['ProvisionsAllDevices'] != true &&
        Time.parse(values.fetch('ExpirationDate').to_s) > Time.now
    end

    def inspect_privacy(target, id)
      path = File.join(target, 'PrivacyInfo.xcprivacy')
      unless File.file?(path)
        return @report.check("privacy.#{id}", false, 'Packaged target is missing its privacy manifest.')
      end

      @report.check("privacy.#{id}", declared_privacy?(Readiness.plist(path)),
                    'Packaged app/widget privacy manifest must match the current no-collection and ' \
                    'UserDefaults declarations.')
    end

    def declared_privacy?(privacy)
      user_defaults = privacy.fetch('NSPrivacyAccessedAPITypes', []).select do |api|
        api['NSPrivacyAccessedAPIType'] == 'NSPrivacyAccessedAPICategoryUserDefaults'
      end
      privacy['NSPrivacyTracking'] == false && privacy['NSPrivacyCollectedDataTypes'] == [] &&
        user_defaults.any? do |api|
          PRIVACY_REASONS.all? { |reason| api.fetch('NSPrivacyAccessedAPITypeReasons', []).include?(reason) }
        end
    end

    # Saves a tool's plist output in the unpacked folder and parses it.
    def write_plist(name, contents)
      path = File.join(@dir, name)
      File.write(path, contents)
      Readiness.plist(path)
    end
  end

  # Checks an AAB's manifest (through bundletool), signature, and contents.
  class AndroidArtifact
    R8_MAPPING = 'BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map'

    def initialize(report, artifact)
      @report = report
      @artifact = artifact
    end

    def inspect_manifest(bundletool)
      require 'rexml/document'
      require 'zip'
      tool = bundletool ? ['java', '-jar', File.expand_path(bundletool)] : ['bundletool']
      manifest = REXML::Document.new(
        Readiness.command(*tool, 'dump', 'manifest', "--bundle=#{@artifact}", '--module=base')
      ).root
      record_versions(manifest)
      check_manifest(manifest)
      @report.attempt('artifact.bundle_structure', verification: true) { validate_bundle(tool) }
    end

    def inspect_signature
      signature = Readiness.command('jarsigner', '-verify', @artifact)
      verified = signature.include?('jar verified.') && !signature.include?('unsigned entries')
      @report.check('artifact.signature', verified,
                    'AAB JAR signature must verify with no unsigned entries. ' \
                    'This does not establish the Play upload-key identity.')
    end

    def inspect_contents
      require 'zip'
      Zip::File.open(@artifact) do |zip|
        @report.check('artifact.r8_mapping', !zip.find_entry(R8_MAPPING).nil?,
                      'Expected the release obfuscation mapping in the AAB.')
        record_native_libraries(zip.entries.map(&:name).grep(%r{^[^/]+/lib/.*\.so$}))
      end
    end

    private

    def validate_bundle(tool)
      Readiness.command(*tool, 'validate', "--bundle=#{@artifact}")
      @report.add('artifact.bundle_structure', 'verified', 'bundletool validation passed.')
    end

    def record_native_libraries(native)
      @report.data[:artifact][:native_libraries] = native
      if native.empty?
        @report.add('artifact.native_page_size', 'not_applicable', 'No native libraries.')
      else
        @report.add('artifact.native_page_size', 'unverified',
                    'Verify ELF and generated APK 16KB alignment for the listed native libraries.')
      end
    end

    def record_versions(manifest)
      sdk = manifest.elements['uses-sdk']&.attributes
      @report.data[:artifact].merge!(
        version: manifest.attributes['android:versionName'], build_number: manifest.attributes['android:versionCode'],
        target_sdk: sdk&.[]('android:targetSdkVersion'), minimum_sdk: sdk&.[]('android:minSdkVersion')
      )
    end

    def check_manifest(manifest)
      app = manifest.elements['application']
      @report.check('artifact.identifier', manifest.attributes['package'] == 'net.a2f0.nc', 'Expected net.a2f0.nc.')
      @report.check('artifact.release', app && app.attributes['android:debuggable'] != 'true',
                    'Release manifest must disallow debugging.')
      check_permissions(manifest)
    end

    def check_permissions(manifest)
      permissions = manifest.get_elements('uses-permission').map { |permission| permission.attributes['android:name'] }
      @report.data[:artifact][:permissions] = permissions
      @report.check('artifact.offline_permissions', !permissions.include?('android.permission.INTERNET'),
                    'Native playback/history should not request INTERNET.')
    end
  end
end
