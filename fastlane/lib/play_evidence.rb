# frozen_string_literal: true

require_relative 'readiness'
require 'net/http'
require 'uri'

# Public review evidence is immutable video bytes plus a small current pointer.
# A video is specific to an AAB, not merely to its version label.
module PlayEvidence
  URL = 'https://nc.a2f0.net/review/android-media-playback.json'
  BUCKET = 'nc-store-evidence'
  POINTER = 'android-media-playback/current.json'
  SHA = /\A[0-9a-f]{64}\z/
  COMMIT = /\A[0-9a-f]{40}\z/
  MAX_VIDEO_BYTES = 25 * 1024 * 1024
  STEPS = %w[user_start background_media_playback notification_stop].freeze
  # Web-only releases do not require rebuilding the Android artifact.
  AAB_INPUTS = %w[android assets/brand agent-tool.json .mise.toml scripts/dev/ensureGradleWrapper.sh].freeze
  INTEGRITY_FAILURE = 'Evidence manifest or video failed integrity validation. ' \
                      'Regenerate and review the recording before publishing.'
  class InvalidEvidence < StandardError; end

  # The fields a recording's manifest must have, checked in order.
  module Manifest
    def self.sha?(value) = value.is_a?(String) && value.match?(SHA)

    RULES = {
      'Unsupported evidence manifest' => ->(data) { data['schema_version'] == 1 },
      'Wrong application' => ->(data) { data['application_id'] == 'net.a2f0.nc' },
      'Wrong permission' => ->(data) { data['permission'] == 'FOREGROUND_SERVICE_MEDIA_PLAYBACK' },
      'Invalid source_commit' => ->(data) { data['source_commit'].to_s.match?(COMMIT) },
      'Invalid capture_commit' => ->(data) { data['capture_commit'].to_s.match?(COMMIT) },
      'Invalid version' => lambda do |data|
        data['version_name'].is_a?(String) && data['version_name'].length.between?(1, 100)
      end,
      'Invalid aab_sha256' => ->(data) { sha?(data['aab_sha256']) },
      'Invalid apk_sha256' => ->(data) { sha?(data['apk_sha256']) },
      'Invalid video_sha256' => ->(data) { sha?(data['video_sha256']) },
      'Invalid object key' => ->(data) { data['video_key'] == "android-media-playback/#{data['video_sha256']}.mp4" },
      'Invalid video size' => lambda do |data|
        data['video_bytes'].is_a?(Integer) && data['video_bytes'].between?(1, MAX_VIDEO_BYTES)
      end,
      'Missing recorded audio' => ->(data) { data['audio'] == true },
      'Invalid duration' => lambda do |data|
        data['duration_seconds'].is_a?(Numeric) && data['duration_seconds'].between?(15, 180)
      end,
      'Incomplete demonstration' => ->(data) { data['verified_steps'] == STEPS },
      'Invalid build' => lambda do |data|
        data['version_code'].is_a?(String) && data['version_code'].match?(/\A[1-9][0-9]*\z/)
      end,
      'Invalid capture date' => ->(data) { Time.iso8601(data.fetch('recorded_at')) }
    }.freeze

    # Raises naming the first rule the manifest breaks.
    def self.validate(data)
      raise InvalidEvidence, 'Invalid evidence manifest' unless data.is_a?(Hash)

      broken, = RULES.find { |_message, rule| !rule.call(data) }
      raise InvalidEvidence, broken if broken

      data
    rescue ArgumentError, TypeError, KeyError
      raise InvalidEvidence, 'Invalid evidence fields'
    end
  end

  def self.validate(data) = Manifest.validate(data)

  def self.sha256(path) = Digest::SHA256.file(path).hexdigest

  def self.artifact_source(artifact, root)
    source = receipt_source(artifact)
    AAB_INPUTS.each do |path|
      recorded = Readiness.command('git', '-C', root, 'rev-parse', "#{source['commit']}:#{path}").strip
      current = Readiness.command('git', '-C', root, 'rev-parse', "HEAD:#{path}").strip
      raise "AAB predates changes to #{path}" unless recorded == current
    end
    source
  end

  def self.receipt_source(artifact)
    raise 'Missing AAB receipt; run android build_release first' unless File.file?("#{artifact}.build.json")

    receipt = JSON.parse(File.read("#{artifact}.build.json"))
    source = receipt.fetch('source')
    raise 'AAB receipt does not match' unless receipt['schema_version'] == 1 && receipt['sha256'] == sha256(artifact)
    raise 'AAB source is not clean' unless source['dirty'] == false && source['commit'].to_s.match?(COMMIT)

    source
  end

  def self.inspect_local(path)
    data = validate(JSON.parse(File.read(path)))
    video = File.join(File.dirname(path), 'android-media-playback.mp4')
    matches = File.size(video) == data['video_bytes'] && sha256(video) == data['video_sha256']
    raise InvalidEvidence, 'Video bytes do not match manifest' unless matches

    [data, video]
  end

  def self.fetch(url, limit)
    uri = URI(url)
    unless uri.scheme == 'https' && uri.host == 'nc.a2f0.net' && uri.port == 443
      raise 'Evidence must use the app HTTPS origin'
    end

    body = +''
    Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 10, read_timeout: 30) do |http|
      http.request(Net::HTTP::Get.new(uri)) { |response| read_limited(response, body, limit) }
    end
    body
  end

  def self.read_limited(response, body, limit)
    raise "Evidence HTTP #{response.code}" unless response.code == '200'

    response.read_body do |part|
      body << part
      raise 'Evidence exceeds size limit' if body.bytesize > limit
    end
  end

  def self.check(report, artifact, manifest_path: nil, online: true)
    unless manifest_path || online
      return report.add('evidence.android_video', 'unverified',
                        'Published foreground-service video was not fetched in offline mode.')
    end

    report.attempt('evidence.android_video') do
      data = manifest_path ? local_evidence(report, manifest_path) : published_evidence
      record(report, artifact, data)
    rescue InvalidEvidence, JSON::ParserError
      report.add('evidence.android_video', 'failed', INTEGRITY_FAILURE)
    end
  end

  def self.local_evidence(report, manifest_path)
    data, = inspect_local(manifest_path)
    report.add('evidence.android_video_public', 'unverified',
               'Only local evidence was inspected; the public review URL was not checked.')
    data
  end

  def self.published_evidence
    data = validate(JSON.parse(fetch(URL, 32 * 1024)))
    # Fetch the immutable key so a concurrent publication cannot mix versions.
    bytes = fetch("https://nc.a2f0.net/review/#{data['video_key']}", MAX_VIDEO_BYTES)
    matches = bytes.bytesize == data['video_bytes'] && Digest::SHA256.hexdigest(bytes) == data['video_sha256']
    raise InvalidEvidence, 'Published video does not match manifest' unless matches

    data
  end

  def self.record(report, artifact, data)
    report.check('evidence.android_video_hash', true, 'Recorded video bytes match the evidence manifest.')
    report.check('evidence.android_video_candidate',
                 File.file?(artifact) && data['aab_sha256'] == sha256(artifact),
                 'The foreground-service demonstration must match this exact AAB; ' \
                 'rerun android foreground_service_video after changing candidates.')
    report.data[:foreground_service_video] = data.slice('recorded_at', 'version_code', 'video_sha256', 'aab_sha256')
    report.add('evidence.android_video_review', 'unverified',
               'Watch the public video with sound and enter its link in the Play Console foreground-service ' \
               'declaration. Publication is not Google approval.')
  end
end
