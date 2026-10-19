# frozen_string_literal: true

require_relative 'readiness'

module Readiness
  # Poll only the exact app version/build. An older successful build cannot satisfy it.
  def self.wait_for_build(timeout:, interval: 15, clock: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }, sleeper: ->(seconds) { sleep(seconds) })
    deadline = clock.call + timeout
    loop do
      build = yield
      return build if build && build.processing_state != 'PROCESSING'
      remaining = deadline - clock.call
      return build if remaining <= 0
      sleeper.call([interval, remaining].min)
    end
  end

  def self.ios_store(report, locales:, timeout: 0)
    report.attempt('store.ios') do
      app = Spaceship::ConnectAPI::App.find('net.a2f0.nc')
      raise 'App missing' unless app
      version_string = report.data[:artifact][:version]
      number = report.data[:artifact][:build_number]
      unless version_string && number
        report.add('store.candidate', 'unverified', 'Artifact version/build could not be inspected; no latest-build substitution was made.')
        return
      end
      build = wait_for_build(timeout: timeout) do
        Spaceship::ConnectAPI::Build.all(app_id: app.id, version: version_string, build_number: number,
                                         platform: Spaceship::ConnectAPI::Platform::IOS).find { |b| b.version == number && b.app_version == version_string }
      end
      if build.nil? || build.processing_state == 'PROCESSING'
        report.add('store.processed_build', 'unverified', 'Exact artifact version/build is absent or still processing within the wait limit.')
      else
        report.check('store.processed_build', build.processing_state == 'VALID' && !build.expired, "Exact version/build processing state: #{build.processing_state}; expired: #{!!build.expired}.")
      end
      version = app.get_app_store_versions(filter: { versionString: version_string, platform: Spaceship::ConnectAPI::Platform::IOS }).first
      unless version
        report.check('store.version', false, 'No App Store version matches the artifact version.')
        return
      end
      report.check('store.selected_build', build && version.build&.id == build.id, 'The matching candidate must be selected on the App Store version.')
      review = begin
        version.fetch_app_store_review_detail
      rescue RuntimeError => error
        raise unless error.message == 'No data'
        nil
      end
      complete = review && %i[contact_first_name contact_last_name contact_phone contact_email].all? { |field| !review.public_send(field).to_s.strip.empty? }
      report.check('store.review_contact', complete, 'Review contact fields must be populated; values are not logged.')
      report.check('store.review_notes', review && !review.notes.to_s.strip.empty?, 'Review notes should explain background audio, widgets, and local history.')
      entries = version.get_app_store_version_localizations
      locales.each do |locale|
        entry = entries.find { |candidate| candidate.locale == locale }
        report.check("store.listing.#{locale}", entry && !entry.description.to_s.strip.empty? && !entry.support_url.to_s.strip.empty?, 'Expected localized description and support URL.')
        next unless entry
        sets = entry.get_app_screenshot_sets
        # Count only completed uploads, not reserved or failed screenshot slots.
        types = sets.select { |set| set.app_screenshots.to_a.any? { |shot| shot.asset_delivery_state&.fetch('state', nil) == 'COMPLETE' } }.map(&:screenshot_display_type)
        report.check("store.screenshots.#{locale}", types.any? { |type| type.start_with?('APP_IPHONE') } && types.any? { |type| type.start_with?('APP_IPAD') }, 'Expected completed iPhone and iPad screenshots; visual accuracy still needs review.')
      end
      report.add('store.privacy_url', 'unverified', 'Verify the app-level privacy URL and App Privacy declarations in App Store Connect.')
    end
  end

  def self.with_play_edit(service, package)
    edit = service.insert_edit(package, Google::Apis::AndroidpublisherV3::AppEdit.new)
    begin
      yield edit.id
    ensure
      service.delete_edit(package, edit.id)
    end
  end

  def self.android_store(report, key_path:, locales:, track: 'internal')
    unless report.data[:artifact][:build_number]
      report.add('store.candidate', 'unverified', 'Artifact version code could not be inspected; no latest-build substitution was made.')
      return
    end
    report.attempt('store.android') do
      require 'google/apis/androidpublisher_v3'
      require 'googleauth'
      service = Google::Apis::AndroidpublisherV3::AndroidPublisherService.new
      service.client_options.open_timeout_sec = 30
      service.client_options.read_timeout_sec = 30
      File.open(key_path) do |file|
        service.authorization = Google::Auth::ServiceAccountCredentials.make_creds(json_key_io: file, scope: 'https://www.googleapis.com/auth/androidpublisher')
      end
      android_store_records(report, service: service, locales: locales, track: track)
    end
  end

  def self.android_store_records(report, service:, locales:, track:)
    report.attempt('store.android') do
      package = 'net.a2f0.nc'
      with_play_edit(service, package) do |edit|
        number = report.data[:artifact][:build_number]
        releases = service.get_edit_track(package, edit, track).releases.to_a
        release = releases.find { |candidate| candidate.version_codes.to_a.map(&:to_s).include?(number) } if number
        report.check('store.track_candidate', release && %w[completed inProgress].include?(release.status), "Artifact version code must be active on #{track}; internal acceptance does not establish production eligibility.")
        bundles = service.list_edit_bundles(package, edit).bundles.to_a
        bundle = bundles.find { |candidate| candidate.version_code.to_s == number } if number
        report.check('store.bundle_hash', bundle && bundle.sha256.to_s.downcase == report.data[:artifact][:sha256], 'Play bundle SHA-256 must match the inspected AAB.')
        listings = service.list_edit_listings(package, edit).listings.to_a
        locales.each do |locale|
          listing = listings.find { |candidate| candidate.language == locale }
          report.check("store.listing.#{locale}", listing && %i[title short_description full_description].all? { |field| !listing.public_send(field).to_s.strip.empty? }, 'Expected localized title and descriptions.')
          unless listing
            report.check("store.screenshots.#{locale}", false, 'No listing exists for the expected screenshot locale.')
            next
          end
          images = service.list_edit_images(package, edit, locale, 'phoneScreenshots').images.to_a
          report.check("store.screenshots.#{locale}", !images.empty?, 'Expected phone screenshots; visual accuracy still needs review.')
        end
      end
    end
  end
end
