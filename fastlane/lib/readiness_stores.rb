# frozen_string_literal: true

require_relative 'readiness'
require_relative 'store_listing'

# Store inspection: what App Store Connect and Google Play hold for the candidate.
module Readiness
  # Poll only the exact app version/build. An older successful build cannot satisfy it.
  def self.wait_for_build(timeout:, interval: 15, clock: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) },
                          sleeper: ->(seconds) { sleep(seconds) })
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

      version, number = report.data[:artifact].values_at(:version, :build_number)
      unless version && number
        next report.add('store.candidate', 'unverified',
                        'Artifact version/build could not be inspected; no latest-build substitution was made.')
      end

      IosStore.new(report, app, version, number).inspect_candidate(locales: locales, timeout: timeout)
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
      report.add('store.candidate', 'unverified',
                 'Artifact version code could not be inspected; no latest-build substitution was made.')
      return
    end
    report.attempt('store.authentication') do
      android_store_records(report, service: play_service(key_path), locales: locales, track: track)
    end
  end

  def self.play_service(key_path)
    require 'google/apis/androidpublisher_v3'
    require 'googleauth'
    service = Google::Apis::AndroidpublisherV3::AndroidPublisherService.new
    service.client_options.open_timeout_sec = 30
    service.client_options.read_timeout_sec = 30
    service.authorization = play_credentials(key_path)
    service
  end

  def self.play_credentials(key_path)
    File.open(key_path) do |file|
      Google::Auth::ServiceAccountCredentials.make_creds(
        json_key_io: file, scope: 'https://www.googleapis.com/auth/androidpublisher'
      )
    end
  end

  def self.android_store_records(report, service:, locales:, track:)
    report.attempt('store.android') do
      with_play_edit(service, PlayStore::PACKAGE) do |edit|
        play = PlayStore.new(report, service, edit)
        play.check_track(track)
        play.check_bundle
        play.check_listings(locales)
      end
    end
  end

  # Checks the App Store Connect records for the artifact's exact version and build.
  class IosStore
    REVIEW_CONTACT = %i[contact_first_name contact_last_name contact_phone contact_email].freeze

    def initialize(report, app, version, number)
      @report = report
      @app = app
      @version = version
      @number = number
    end

    def inspect_candidate(locales:, timeout:)
      build = processed_build(timeout)
      store_version = @app.get_app_store_versions(
        filter: { versionString: @version, platform: Spaceship::ConnectAPI::Platform::IOS }
      ).first
      unless store_version
        return @report.check('store.version', false, 'No App Store version matches the artifact version.')
      end

      check_version(store_version, build, locales)
    end

    private

    def check_version(store_version, build, locales)
      @report.check('store.selected_build', build && store_version.build&.id == build.id,
                    'The matching candidate must be selected on the App Store version.')
      check_review(store_version)
      check_listings(store_version, locales)
      @report.add('store.privacy_url', 'unverified',
                  'Verify the app-level privacy URL and App Privacy declarations in App Store Connect.')
    end

    def processed_build(timeout)
      build = Readiness.wait_for_build(timeout: timeout) { candidate_build }
      if build.nil? || build.processing_state == 'PROCESSING'
        @report.add('store.processed_build', 'unverified',
                    'Exact artifact version/build is absent or still processing within the wait limit.')
      else
        @report.check('store.processed_build', build.processing_state == 'VALID' && !build.expired,
                      "Exact version/build processing state: #{build.processing_state}; expired: #{!!build.expired}.")
      end
      build
    end

    def candidate_build
      Spaceship::ConnectAPI::Build.all(
        app_id: @app.id, version: @version, build_number: @number, platform: Spaceship::ConnectAPI::Platform::IOS
      ).find { |build| build.version == @number && build.app_version == @version }
    end

    def check_review(store_version)
      review = review_detail(store_version)
      complete = review && REVIEW_CONTACT.all? { |field| !review.public_send(field).to_s.strip.empty? }
      @report.check('store.review_contact', complete, 'Review contact fields must be populated; values are not logged.')
      @report.check('store.review_notes', review && !review.notes.to_s.strip.empty?,
                    'Review notes should explain background audio, widgets, and local history.')
    end

    def review_detail(store_version)
      store_version.fetch_app_store_review_detail
    rescue RuntimeError => e
      raise unless e.message == 'No data'

      nil
    end

    def check_listings(store_version, locales)
      entries = store_version.get_app_store_version_localizations
      locales.each do |locale|
        entry = entries.find { |candidate| candidate.locale == locale }
        @report.check("store.listing.#{locale}", listed?(entry), 'Expected localized description and support URL.')
        check_screenshots(entry, locale) if entry && locale == StoreListing::LOCALE
      end
    end

    def listed?(entry)
      entry && !entry.description.to_s.strip.empty? && !entry.support_url.to_s.strip.empty?
    end

    def check_screenshots(entry, locale)
      # Count only completed uploads, not reserved or failed screenshot slots.
      types = entry.get_app_screenshot_sets.select { |set| uploaded?(set) }.map(&:screenshot_display_type)
      devices = types.any? { |type| type.start_with?('APP_IPHONE') } && types.any? do |type|
        type.start_with?('APP_IPAD')
      end
      @report.check("store.screenshots.#{locale}", devices,
                    'Expected completed iPhone and iPad screenshots; visual accuracy still needs review.')
    end

    def uploaded?(set)
      set.app_screenshots.to_a.any? { |shot| shot.asset_delivery_state&.fetch('state', nil) == 'COMPLETE' }
    end
  end

  # Checks a Google Play edit's track, bundle, and listings for the artifact's version code.
  class PlayStore
    PACKAGE = 'net.a2f0.nc'
    LISTING_FIELDS = %i[title short_description full_description].freeze

    def initialize(report, service, edit)
      @report = report
      @service = service
      @edit = edit
      @number = report.data[:artifact][:build_number]
    end

    def check_track(track)
      releases = @service.get_edit_track(PACKAGE, @edit, track).releases.to_a
      release = releases.find { |candidate| candidate.version_codes.to_a.map(&:to_s).include?(@number) } if @number
      @report.check('store.track_candidate', release && %w[completed inProgress].include?(release.status),
                    "Artifact version code must be active on #{track}; " \
                    'internal acceptance does not establish production eligibility.')
    end

    def check_bundle
      bundles = @service.list_edit_bundles(PACKAGE, @edit).bundles.to_a
      bundle = bundles.find { |candidate| candidate.version_code.to_s == @number } if @number
      @report.check('store.bundle_hash', bundle && bundle.sha256.to_s.downcase == @report.data[:artifact][:sha256],
                    'Play bundle SHA-256 must match the inspected AAB.')
    end

    def check_listings(locales)
      listings = @service.list_edit_listings(PACKAGE, @edit).listings.to_a
      locales.each do |locale|
        listing = listings.find { |candidate| candidate.language == locale }
        complete = listing && LISTING_FIELDS.all? { |field| !listing.public_send(field).to_s.strip.empty? }
        @report.check("store.listing.#{locale}", complete, 'Expected localized title and descriptions.')
        check_screenshots(listing, locale) if locale == StoreListing::LOCALE
      end
    end

    private

    def check_screenshots(listing, locale)
      unless listing
        return @report.check("store.screenshots.#{locale}", false,
                             'No listing exists for the expected screenshot locale.')
      end

      images = @service.list_edit_images(PACKAGE, @edit, locale, 'phoneScreenshots').images.to_a
      @report.check("store.screenshots.#{locale}", !images.empty?,
                    'Expected phone screenshots; visual accuracy still needs review.')
    end
  end
end
