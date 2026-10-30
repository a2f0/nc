# frozen_string_literal: true

require 'digest'
require 'tmpdir'
require_relative '../lib/native_release_target'
require_relative '../lib/play_evidence'
require_relative '../lib/play_version_code'
require_relative '../lib/readiness_artifacts'
require_relative '../lib/readiness_stores'
require_relative '../lib/store_listing'

ANDROID_DIR = File.join(REPO_ROOT, 'android')
ANDROID_OUTPUTS_DIR = File.join(ANDROID_DIR, 'app/build/outputs')
ANDROID_RELEASE_AAB = File.join(ANDROID_OUTPUTS_DIR, 'bundle/release/app-release.aab')
ANDROID_RELEASE_MAPPING = File.join(ANDROID_OUTPUTS_DIR, 'mapping/release/mapping.txt')
ANDROID_METADATA_DIR = File.join(REPO_ROOT, 'fastlane/metadata/android')
ANDROID_EVIDENCE_MANIFEST = '.store-evidence/android-media-playback/manifest.json'
GOOGLE_PLAY_TRACKS = %w[production beta alpha internal].freeze
# What the readiness lane expects the App Bundle to hold. Without INTERNET,
# native playback and history stay on the device; the other permissions come
# from foreground media playback, the widgets' WorkManager, and AndroidX.
# Release builds are minified.
ANDROID_READINESS_EXPECTATIONS = {
  identifier: NATIVE_APP_IDENTIFIER,
  permissions: %W[
    android.permission.FOREGROUND_SERVICE
    android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK
    android.permission.WAKE_LOCK
    android.permission.ACCESS_NETWORK_STATE
    android.permission.RECEIVE_BOOT_COMPLETED
    #{NATIVE_APP_IDENTIFIER}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
  ],
  minified: true
}.freeze

def google_play_track(options)
  track = options.fetch(:track, 'internal').to_s
  return track if GOOGLE_PLAY_TRACKS.include?(track)

  UI.user_error!("Unsupported Play track #{track.inspect}; use one of #{GOOGLE_PLAY_TRACKS.join(', ')}")
end

def next_google_play_version_code
  missing = lambda do |track, error|
    UI.important("No version codes from the #{track} track (#{error.message.lines.first&.strip})")
  end
  PlayVersionCode.next_code(GOOGLE_PLAY_TRACKS, on_missing: missing) do |track|
    google_play_track_version_codes(
      package_name: NATIVE_APP_IDENTIFIER, track: track, json_key: GOOGLE_PLAY_JSON_KEY_PATH
    )
  end
end

def bundletool_path(options)
  tool = options[:bundletool] || ENV.fetch('BUNDLETOOL_JAR', nil)
  tool && File.expand_path(tool, REPO_ROOT)
end

platform :android do
  desc 'Record user-started background playback and notification stop from the release AAB (artifact:, bundletool:)'
  lane :foreground_service_video do |options|
    artifact = File.expand_path(options.fetch(:artifact, ANDROID_RELEASE_AAB), REPO_ROOT)
    tool = bundletool_path(options)
    UI.user_error!('Pass bundletool:/absolute/path/bundletool.jar or set BUNDLETOOL_JAR') unless tool
    sh('ruby', File.join(REPO_ROOT, 'scripts/testing/recordAndroidForegroundVideo.rb'), artifact, tool)
  end

  desc 'Publish a reviewed foreground-service video to R2, updating the stable pointer last ' \
       '(reviewed:true, manifest:, artifact:)'
  lane :publish_foreground_service_video do |options|
    unless options[:reviewed].to_s == 'true'
      UI.user_error!('Watch the recording with sound, then pass reviewed:true to publish it')
    end
    path = File.expand_path(options.fetch(:manifest, ANDROID_EVIDENCE_MANIFEST), REPO_ROOT)
    data, video = PlayEvidence.inspect_local(path)
    artifact = File.expand_path(options.fetch(:artifact, ANDROID_RELEASE_AAB), REPO_ROOT)
    unless File.file?(artifact) && Digest::SHA256.file(artifact).hexdigest == data['aab_sha256']
      UI.user_error!('Recording does not match the candidate AAB')
    end
    sh('bunx', '--no-install', 'wrangler', 'r2', 'object', 'put', "#{PlayEvidence::BUCKET}/#{data['video_key']}",
       '--file', video, '--content-type', 'video/mp4', '--remote')
    sh('bunx', '--no-install', 'wrangler', 'r2', 'object', 'put', "#{PlayEvidence::BUCKET}/#{PlayEvidence::POINTER}",
       '--file', path, '--content-type', 'application/json', '--remote')
    UI.success('Published: https://nc.a2f0.net/review/android-media-playback')
  end

  # Signs the bundle with the upload key and writes a source/hash receipt
  # (<aab>.build.json) beside it, which the readiness lane checks.
  # build_number: is the version code; it defaults to one past the highest on
  # any Google Play track.
  desc 'Build a signed release App Bundle without uploading it (build_number:)'
  lane :build_release do |options|
    UI.user_error!('version_code: is now build_number:') if options.key?(:version_code)
    source = release_source
    load_store_secrets(ANDROID_SECRETS)
    ANDROID_SECRETS.each { |name| required_env(name) }
    UI.user_error!("Missing upload keystore: #{ANDROID_KEYSTORE_PATH}") unless File.file?(ANDROID_KEYSTORE_PATH)

    build_number = options[:build_number]&.to_i || next_google_play_version_code
    UI.message("Building #{NATIVE_APP_IDENTIFIER} version code #{build_number}")
    sh('sh', File.join(REPO_ROOT, 'scripts/dev/ensureGradleWrapper.sh'))
    # Gradle reads the keystore passwords from the environment loaded above.
    gradle(
      project_dir: ANDROID_DIR, task: 'bundleRelease', flags: '--console=plain',
      properties: { 'ncVersionCode' => build_number, 'ncUploadKeystore' => ANDROID_KEYSTORE_PATH }
    )
    UI.user_error!("App Bundle was not created: #{ANDROID_RELEASE_AAB}") unless File.file?(ANDROID_RELEASE_AAB)
    Readiness.record_build(ANDROID_RELEASE_AAB, source, root: REPO_ROOT)
    UI.success("App Bundle: #{ANDROID_RELEASE_AAB}")
    ANDROID_RELEASE_AAB
  end

  # Uploads to internal testing by default and rolls the release out, with no
  # Play Console step. A new Play app only accepts draft releases until its
  # first release has been rolled out by hand; release_status:draft uploads one
  # without rolling it out. track:beta is open testing: Google reviews each
  # release before testers get it, and the track only takes releases once open
  # testing is set up in Play Console (its countries, and for a personal account
  # created since November 2023, production access). Internal releases aren't sent
  # for review: committing an edit that is sent cancels any review in progress and
  # restarts it, so they wait for the next release that is. If Play refuses that,
  # the upload fails rather than letting supply retry it as sent for review.
  # Listing text and images go up separately, through the listing lane.
  desc 'Run build_release, then upload to a Google Play track ' \
       '(build_number:, track:internal, release_status:completed)'
  lane :upload_release do |options|
    track = google_play_track(options)
    internal = track == 'internal'
    aab = build_release(options)
    upload_to_play_store(
      package_name: NATIVE_APP_IDENTIFIER, json_key: GOOGLE_PLAY_JSON_KEY_PATH,
      aab: aab, mapping: ANDROID_RELEASE_MAPPING,
      track: track, release_status: options.fetch(:release_status, 'completed'),
      changes_not_sent_for_review: internal, rescue_changes_not_sent_for_review: !internal,
      skip_upload_apk: true, skip_upload_metadata: true, skip_upload_changelogs: true,
      skip_upload_images: true, skip_upload_screenshots: true
    )
  end

  # Promotes the open testing release rather than building a new one, so
  # production gets the App Bundle testers had. Google reviews it first, and
  # Play rejects it until production has countries, which only Play Console
  # sets. Pass version_code: when the track has more than one release, and
  # rollout:0.1 to roll an update out to a share of users.
  desc 'Promote the Google Play open testing release to production (version_code:, rollout:)'
  lane :promote_release do |options|
    upload_to_play_store(
      package_name: NATIVE_APP_IDENTIFIER, json_key: GOOGLE_PLAY_JSON_KEY_PATH,
      track: 'beta', track_promote_to: 'production', track_promote_release_status: 'completed',
      **options.slice(:version_code, :rollout),
      skip_upload_apk: true, skip_upload_aab: true, skip_upload_metadata: true,
      skip_upload_changelogs: true, skip_upload_images: true, skip_upload_screenshots: true
    )
  end

  # docs/readiness.md describes the options.
  desc 'Inspect an existing AAB and its Play state and write a redacted readiness report, without uploading or ' \
       'committing edits (artifact:, output:, track:internal, bundletool:, evidence:, store:false, strict:true)'
  lane :readiness do |options|
    artifact, output = readiness_options(options, 'android', ANDROID_RELEASE_AAB)
    track = google_play_track(options)
    online = options[:store].to_s != 'false'
    report = Readiness::Report.new('android', artifact, REPO_ROOT)
    Readiness.android_artifact(report, artifact, ANDROID_READINESS_EXPECTATIONS, bundletool: bundletool_path(options))
    if online
      Readiness.android_store(report, package: NATIVE_APP_IDENTIFIER, key_path: GOOGLE_PLAY_JSON_KEY_PATH,
                                      listing: readiness_listing(ANDROID_METADATA_DIR, 'title.txt'), track: track)
    else
      report.add('store.android', 'unverified', 'Store inspection explicitly skipped.')
    end
    evidence_path = options[:evidence] && File.expand_path(options[:evidence], REPO_ROOT)
    PlayEvidence.check(report, artifact, manifest_path: evidence_path, online: online)
    finish_readiness(report, output, options)
  end

  # supply only uploads a listing along with a release, so this attaches it to
  # the newest internal one. With no binaries, rollout, promotion, or changelogs,
  # supply only reads that release (it never calls update_track or
  # upload_changelogs), so its status and notes stay as they are. Like internal
  # releases, the listing isn't sent for review, so it can't restart one, and
  # fails rather than being retried as sent for review.
  desc 'Upload the Google Play listing: fastlane/metadata/android text, .screenshots/android screenshots, and graphics'
  lane :listing do
    version_code = google_play_track_version_codes(
      package_name: NATIVE_APP_IDENTIFIER, track: 'internal', json_key: GOOGLE_PLAY_JSON_KEY_PATH
    ).map(&:to_i).max
    unless version_code
      UI.user_error!('No internal release to attach the listing to; run `bun run android:upload-release` first.')
    end

    Dir.mktmpdir('nc-listing') do |dir|
      images = StoreListing.with_shared_capture(SCREENSHOTS_DIR, platform: 'android', announce: UI.method(:message)) do
        StoreListing.stage_play_listing(ANDROID_METADATA_DIR, SCREENSHOTS_DIR, dir)
      end
      sh('sh', File.join(REPO_ROOT, 'scripts/build/buildImages.sh'), 'store', '--out', images)
      upload_to_play_store(
        package_name: NATIVE_APP_IDENTIFIER, json_key: GOOGLE_PLAY_JSON_KEY_PATH, metadata_path: dir,
        track: 'internal', version_code: version_code,
        changes_not_sent_for_review: true, rescue_changes_not_sent_for_review: false,
        skip_upload_apk: true, skip_upload_aab: true, skip_upload_changelogs: true, sync_image_upload: true
      )
    end
  end
end
