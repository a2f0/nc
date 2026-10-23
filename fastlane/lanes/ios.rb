# frozen_string_literal: true

require 'shellwords'
require 'tmpdir'
require_relative '../lib/ios_signing_keychain'
require_relative '../lib/native_release_target'
require_relative '../lib/readiness_artifacts'
require_relative '../lib/readiness_stores'
require_relative '../lib/store_listing'

APP_NAME = 'Noise Connoisseur'
APP_SKU = 'noise-connoisseur'
WIDGET_IDENTIFIER = "#{NATIVE_APP_IDENTIFIER}.widget".freeze
APP_GROUP_IDENTIFIER = "group.#{NATIVE_APP_IDENTIFIER}".freeze

IOS_PROJECT = File.join(REPO_ROOT, 'ios/NoiseConnoisseur.xcodeproj')
IOS_SCHEME = 'NoiseConnoisseur'
IOS_TARGET_IDENTIFIERS = {
  'NoiseConnoisseur' => NATIVE_APP_IDENTIFIER,
  'NoiseWidgetExtension' => WIDGET_IDENTIFIER
}.freeze
IOS_OUTPUT_DIR = File.join(REPO_ROOT, 'ios/build/release')
IOS_IPA_NAME = 'NoiseConnoisseur.ipa'
IOS_METADATA_DIR = File.join(REPO_ROOT, 'fastlane/metadata/ios')

# What the readiness lane expects the IPA to hold: the app and its widget, both
# in the App Group, and the declarations of their PrivacyInfo.xcprivacy files.
IOS_READINESS_EXPECTATIONS = {
  targets: { NATIVE_APP_IDENTIFIER => [APP_GROUP_IDENTIFIER], WIDGET_IDENTIFIER => [APP_GROUP_IDENTIFIER] },
  privacy: {
    tracking: false,
    collected_data_types: [],
    accessed_api_reasons: { 'NSPrivacyAccessedAPICategoryUserDefaults' => %w[CA92.1 1C8F.1] }
  }
}.freeze
IOS_WAIT_TIMEOUT_ERROR = 'wait_timeout must be between 0 and 1800 seconds'
IOS_PRECHECK_REJECTION = 'found one or more potential problems that must be addressed'

def ios_signing_keychain(&)
  IosSigningKeychain.with_temporary(
    environment: ENV, setup: method(:create_ios_signing_keychain), cleanup: method(:delete_ios_signing_keychain),
    security: ->(*args) { sh('security', *args, log: false) },
    path: ->(name) { FastlaneCore::Helper.keychain_path(name) }, &
  )
end

# Xcode resolves nested (widget) signing through the default keychain.
# IosSigningKeychain puts it first in the search list.
def create_ios_signing_keychain(name, password)
  create_keychain(
    name: name, password: password, default_keychain: true, unlock: true,
    timeout: 0, lock_when_sleeps: true, add_to_search_list: false, require_create: true
  )
end

# delete_keychain also restores the default keychain create_keychain replaced.
def delete_ios_signing_keychain(name)
  delete_keychain(name: name) if ios_signing_keychain_exists?(name)
end

# Setup can fail before the keychain exists; deleting it then would mask that error.
def ios_signing_keychain_exists?(name)
  base = File.join(Dir.home, 'Library', 'Keychains', name)
  ["#{base}-db", "#{base}.keychain-db", base, "#{base}.keychain"].any? { |path| File.file?(path) }
end

def appstore_profile_names
  IOS_TARGET_IDENTIFIERS.values.to_h do |identifier|
    [identifier, ENV.fetch("sigh_#{identifier}_appstore_profile-name", "match AppStore #{identifier}")]
  end
end

# Pins manual App Store signing on each target's Release configuration for the
# duration of the block, then restores the project file.
def with_manual_ios_signing(team_id, profiles)
  pbxproj = File.join(IOS_PROJECT, 'project.pbxproj')
  original = File.read(pbxproj)
  pin_manual_ios_signing(team_id, profiles)
  yield
ensure
  File.write(pbxproj, original) unless original.nil?
end

def pin_manual_ios_signing(team_id, profiles)
  IOS_TARGET_IDENTIFIERS.each do |target, identifier|
    update_code_signing_settings(
      path: IOS_PROJECT, use_automatic_signing: false, team_id: team_id,
      code_sign_identity: 'Apple Distribution', profile_name: profiles.fetch(identifier),
      targets: [target], build_configurations: ['Release']
    )
  end
end

def ios_build_xcargs(build_number, team_id)
  settings = ["CURRENT_PROJECT_VERSION=#{build_number}", "DEVELOPMENT_TEAM=#{team_id}"]
  keychain = ENV.fetch('MATCH_KEYCHAIN_NAME', '')
  unless keychain.empty?
    flags = Shellwords.escape("--keychain #{FastlaneCore::Helper.keychain_path(keychain)}")
    settings << "OTHER_CODE_SIGN_FLAGS=#{flags}"
  end
  settings.join(' ')
end

# Whether the App Store version being prepared has App Review details yet.
def ios_review_details?
  app = Spaceship::ConnectAPI::App.find(NATIVE_APP_IDENTIFIER)
  version = app&.get_edit_app_store_version(platform: Spaceship::ConnectAPI::Platform::IOS)
  UI.user_error!("No App Store version of #{NATIVE_APP_IDENTIFIER} to edit") unless version
  version.fetch_app_store_review_detail
  true
rescue RuntimeError => e
  # Spaceship raises this for an empty relationship.
  raise unless e.message == 'No data'

  false
end

def ios_readiness_timeout(options)
  timeout = Integer(options.fetch(:wait_timeout, 0).to_s, 10)
  UI.user_error!(IOS_WAIT_TIMEOUT_ERROR) unless (0..1800).cover?(timeout)
  timeout
rescue ArgumentError
  UI.user_error!(IOS_WAIT_TIMEOUT_ERROR)
end

def ios_readiness_listing = readiness_listing(IOS_METADATA_DIR, 'description.txt')

def ios_readiness_store(report, options, timeout)
  report.attempt('store.authentication') do
    load_store_secrets(IOS_SECRETS)
    api_key = app_store_connect_api_key(**app_store_connect_api_key_options)
    Readiness.ios_store(report, app_identifier: NATIVE_APP_IDENTIFIER, listing: ios_readiness_listing, timeout: timeout)
    if options[:precheck].to_s == 'false'
      report.add('store.precheck', 'unverified', 'Metadata precheck explicitly skipped.')
    else
      ios_readiness_precheck(report, api_key)
    end
  end
end

def ios_readiness_precheck(report, api_key)
  report.attempt('store.precheck') do
    passed = precheck(api_key: api_key, app_identifier: NATIVE_APP_IDENTIFIER, include_in_app_purchases: false)
    report.check('store.precheck', passed == true,
                 'Fastlane rules for the editable listing; exact candidate fields are checked separately. ' \
                 'Not a full policy/accessibility audit.')
  rescue FastlaneCore::Interface::FastlaneError => e
    raise unless e.message.include?(IOS_PRECHECK_REJECTION)

    report.check('store.precheck', false, 'Precheck rejected listing metadata; see its rule findings above.')
  end
end

platform :ios do
  desc 'Register the app and widget bundle IDs with App Groups enabled (App Store Connect API key)'
  lane :register_identifiers do
    load_store_secrets(IOS_SECRETS)
    app_store_connect_api_key(**app_store_connect_api_key_options)
    { NATIVE_APP_IDENTIFIER => APP_NAME, WIDGET_IDENTIFIER => "#{APP_NAME} Widget" }.each do |identifier, name|
      bundle_id = Spaceship::ConnectAPI::BundleId.find(identifier) ||
                  Spaceship::ConnectAPI::BundleId.create(
                    name: name, platform: Spaceship::ConnectAPI::Platform::IOS, identifier: identifier
                  )
      app_groups = Spaceship::ConnectAPI::BundleIdCapability::Type::APP_GROUPS
      unless bundle_id.get_capabilities.any? { |capability| capability.capability_type == app_groups }
        bundle_id.create_capability(app_groups)
      end
      UI.success("#{identifier}: registered with App Groups")
    end
  end

  # match keeps the App Store profiles in the encrypted certificates repo
  # (MATCH_GIT_URL), where build_release installs them from. This creates a
  # profile when it's missing or no longer valid; force:true regenerates them,
  # as after the bundle IDs' capabilities or the distribution certificate change.
  # It signs in with the App Store Connect API key.
  desc 'Create or renew the match App Store profiles (force:true regenerates them)'
  lane :profiles do |options|
    load_store_secrets(IOS_SECRETS)
    api_key = app_store_connect_api_key(**app_store_connect_api_key_options)
    ios_signing_keychain do
      # readonly: false overrides the MATCH_READONLY the signing keychain sets.
      match(
        type: 'appstore', app_identifier: IOS_TARGET_IDENTIFIERS.values, api_key: api_key, readonly: false,
        force: options[:force].to_s == 'true'
      )
    end
  end

  # Apple has no API for creating App Store Connect apps or App Groups, so this
  # lane logs in with your Apple ID (APPLE_ID) and needs a 2FA code. Run it once,
  # in a terminal.
  desc 'Create the App Store Connect app, App Group, and App Store profiles (Apple ID login)'
  lane :create_app do
    load_store_secrets(IOS_SECRETS)
    username = required_env('APPLE_ID')
    team_id = required_env('TEAM_ID')

    produce(
      username: username, team_id: team_id, itc_team_id: ENV.fetch('ITC_TEAM_ID', nil),
      app_identifier: NATIVE_APP_IDENTIFIER, app_name: APP_NAME, sku: APP_SKU, language: 'en-US',
      platforms: ['ios'], enable_services: { app_group: 'on' }
    )
    produce(
      username: username, team_id: team_id,
      app_identifier: WIDGET_IDENTIFIER, app_name: "#{APP_NAME} Widget",
      skip_itc: true, enable_services: { app_group: 'on' }
    )

    # Reuses the session produce just opened.
    Spaceship::Portal.login(username)
    Spaceship::Portal.select_team(team_id: team_id)
    group = Spaceship::Portal.app_group.find(APP_GROUP_IDENTIFIER) ||
            Spaceship::Portal.app_group.create!(group_id: APP_GROUP_IDENTIFIER, name: APP_NAME)
    IOS_TARGET_IDENTIFIERS.each_value do |identifier|
      Spaceship::Portal.app.find(identifier).associate_groups([group])
      UI.success("#{identifier}: in #{APP_GROUP_IDENTIFIER}")
    end

    # Profiles embed the App Group, so create them after the association.
    profiles
  end

  # Writes a source/hash receipt (<ipa>.build.json) beside the IPA, which the
  # readiness lane checks. build_number: defaults to one past the latest
  # TestFlight build.
  desc 'Build a signed App Store IPA without uploading it (build_number:)'
  lane :build_release do |options|
    source = release_source
    load_store_secrets(IOS_SECRETS)
    team_id = required_env('TEAM_ID')
    api_key = app_store_connect_api_key(**app_store_connect_api_key_options)
    build_number = options[:build_number]&.to_i ||
                   (latest_testflight_build_number(
                     api_key: api_key, app_identifier: NATIVE_APP_IDENTIFIER, initial_build_number: 0
                   ).to_i + 1)
    UI.message("Building #{NATIVE_APP_IDENTIFIER} build #{build_number}")

    ipa = ios_signing_keychain do
      match(type: 'appstore', app_identifier: IOS_TARGET_IDENTIFIERS.values, api_key: api_key, readonly: true)
      profiles = appstore_profile_names
      with_manual_ios_signing(team_id, profiles) do
        build_app(
          project: IOS_PROJECT, scheme: IOS_SCHEME, configuration: 'Release', clean: true,
          export_method: 'app-store',
          export_options: {
            method: 'app-store', signingStyle: 'manual', teamID: team_id,
            provisioningProfiles: profiles, manageAppVersionAndBuildNumber: false, uploadSymbols: true
          },
          output_directory: IOS_OUTPUT_DIR, output_name: IOS_IPA_NAME,
          xcargs: ios_build_xcargs(build_number, team_id)
        )
      end
    end

    Readiness.record_build(ipa, source, root: REPO_ROOT)
    ipa
  end

  desc 'Run build_release, then upload to TestFlight (build_number:)'
  lane :upload_release do |options|
    ipa = build_release(options)
    api_key = app_store_connect_api_key(**app_store_connect_api_key_options)
    upload_to_testflight(
      api_key: api_key, app_identifier: NATIVE_APP_IDENTIFIER, ipa: ipa,
      skip_submission: true, skip_waiting_for_build_processing: true, uses_non_exempt_encryption: false
    )
  end

  # docs/readiness.md describes the options.
  desc 'Inspect an existing IPA and its store state and write a redacted readiness report, without uploading or ' \
       'submitting (artifact:, output:, wait_timeout:0, store:false, precheck:false, strict:true)'
  lane :readiness do |options|
    artifact, output = readiness_options(options, 'ios', File.join(IOS_OUTPUT_DIR, IOS_IPA_NAME))
    timeout = ios_readiness_timeout(options)
    report = Readiness::Report.new('ios', artifact, REPO_ROOT)
    Readiness.ios_artifact(report, artifact, IOS_READINESS_EXPECTATIONS)
    if options[:store].to_s == 'false'
      report.add('store.ios', 'unverified', 'Store inspection explicitly skipped.')
    else
      ios_readiness_store(report, options, timeout)
    end
    finish_readiness(report, output, options)
  end

  # Edits the version being prepared for submission; doesn't submit it. deliver
  # can't upload the text until that version's App Review details exist
  # (fastlane/fastlane#20538), and creating them takes a contact name and phone
  # number, which stay out of the repository. Until they're added in App Store
  # Connect, this uploads only the screenshots and then fails.
  desc 'Upload the App Store listing: fastlane/metadata/ios text and .screenshots/ios screenshots'
  lane :listing do
    load_store_secrets(IOS_SECRETS)
    api_key = app_store_connect_api_key(**app_store_connect_api_key_options)
    review_details = ios_review_details?
    Dir.mktmpdir('nc-listing') do |dir|
      deliver(
        api_key: api_key, app_identifier: NATIVE_APP_IDENTIFIER, platform: 'ios',
        metadata_path: IOS_METADATA_DIR, skip_metadata: !review_details,
        screenshots_path: StoreListing.stage_ios_screenshots(SCREENSHOTS_DIR, dir),
        overwrite_screenshots: true, skip_binary_upload: true, skip_app_version_update: true,
        submit_for_review: false, run_precheck_before_submit: false, force: true
      )
    end
    next if review_details

    UI.user_error!(
      'Uploaded the screenshots but not the text: add the App Review contact name and phone number ' \
      '(App Store Connect → the version → App Review Information), then run this again.'
    )
  end
end
