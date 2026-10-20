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
  class InvalidEvidence < StandardError; end

  def self.validate(data)
    raise InvalidEvidence, 'Invalid evidence manifest' unless data.is_a?(Hash)
    raise InvalidEvidence, 'Unsupported evidence manifest' unless data['schema_version'] == 1
    raise InvalidEvidence, 'Wrong application' unless data['application_id'] == 'net.a2f0.nc'
    raise InvalidEvidence, 'Wrong permission' unless data['permission'] == 'FOREGROUND_SERVICE_MEDIA_PLAYBACK'
    %w[source_commit capture_commit].each do |key|
      raise InvalidEvidence, "Invalid #{key}" unless data[key].to_s.match?(/\A[0-9a-f]{40}\z/)
    end
    raise InvalidEvidence, 'Invalid version' unless data['version_name'].is_a?(String) && data['version_name'].length.between?(1, 100)
    %w[aab_sha256 apk_sha256 video_sha256].each do |key|
      raise InvalidEvidence, "Invalid #{key}" unless data[key].is_a?(String) && data[key].match?(SHA)
    end
    expected = "android-media-playback/#{data['video_sha256']}.mp4"
    raise InvalidEvidence, 'Invalid object key' unless data['video_key'] == expected
    raise InvalidEvidence, 'Invalid video size' unless data['video_bytes'].is_a?(Integer) && data['video_bytes'].between?(1, 25 * 1024 * 1024)
    raise InvalidEvidence, 'Missing recorded audio' unless data['audio'] == true
    raise InvalidEvidence, 'Invalid duration' unless data['duration_seconds'].is_a?(Numeric) && data['duration_seconds'].between?(15, 180)
    raise InvalidEvidence, 'Incomplete demonstration' unless data['verified_steps'] == %w[user_start background_media_playback notification_stop]
    raise InvalidEvidence, 'Invalid build' unless data['version_code'].is_a?(String) && data['version_code'].match?(/\A[1-9][0-9]*\z/)
    raise InvalidEvidence, 'Invalid capture date' unless Time.iso8601(data.fetch('recorded_at'))
    data
  rescue ArgumentError, TypeError, KeyError
    raise InvalidEvidence, 'Invalid evidence fields'
  end

  def self.artifact_source(artifact, root)
    receipt = JSON.parse(File.read("#{artifact}.build.json"))
    source = receipt.fetch('source')
    raise 'AAB receipt does not match' unless receipt['schema_version'] == 1 && receipt['sha256'] == Digest::SHA256.file(artifact).hexdigest
    raise 'AAB source is not clean' unless source['dirty'] == false && source['commit'].to_s.match?(/\A[0-9a-f]{40}\z/)
    # Web-only releases do not require rebuilding the Android artifact.
    %w[android assets/brand agent-tool.json .mise.toml scripts/ensureGradleWrapper.sh].each do |path|
      recorded = Readiness.command('git', '-C', root, 'rev-parse', "#{source['commit']}:#{path}").strip
      current = Readiness.command('git', '-C', root, 'rev-parse', "HEAD:#{path}").strip
      raise "AAB predates changes to #{path}" unless recorded == current
    end
    source
  end

  def self.inspect_local(path)
    data = validate(JSON.parse(File.read(path)))
    video = File.join(File.dirname(path), 'android-media-playback.mp4')
    raise InvalidEvidence, 'Video bytes do not match manifest' unless File.size(video) == data['video_bytes'] &&
                                                   Digest::SHA256.file(video).hexdigest == data['video_sha256']
    [data, video]
  end

  def self.fetch(url, limit)
    uri = URI(url)
    raise 'Evidence must use the app HTTPS origin' unless uri.scheme == 'https' && uri.host == 'nc.a2f0.net' && uri.port == 443
    body = +''
    Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 10, read_timeout: 30) do |http|
      http.request(Net::HTTP::Get.new(uri)) do |response|
        raise "Evidence HTTP #{response.code}" unless response.code == '200'
        response.read_body do |part|
          body << part
          raise 'Evidence exceeds size limit' if body.bytesize > limit
        end
      end
    end
    body
  end

  def self.check(report, artifact, manifest_path: nil, online: true)
    if !manifest_path && !online
      report.add('evidence.android_video', 'unverified', 'Published foreground-service video was not fetched in offline mode.')
      return
    end
    report.attempt('evidence.android_video') do
      if manifest_path
        data, = inspect_local(manifest_path)
        report.add('evidence.android_video_public', 'unverified', 'Only local evidence was inspected; the public review URL was not checked.')
      else
        data = validate(JSON.parse(fetch(URL, 32 * 1024)))
        # Fetch the immutable key so a concurrent publication cannot mix versions.
        bytes = fetch("https://nc.a2f0.net/review/#{data['video_key']}", 25 * 1024 * 1024)
        raise InvalidEvidence, 'Published video does not match manifest' unless bytes.bytesize == data['video_bytes'] &&
                                                               Digest::SHA256.hexdigest(bytes) == data['video_sha256']
      end
      report.check('evidence.android_video_hash', true, 'Recorded video bytes match the evidence manifest.')
      report.check('evidence.android_video_candidate', File.file?(artifact) && data['aab_sha256'] == Digest::SHA256.file(artifact).hexdigest,
                   'The foreground-service demonstration must match this exact AAB; rerun android foreground_service_video after changing candidates.')
      report.data[:foreground_service_video] = data.slice('recorded_at', 'version_code', 'video_sha256', 'aab_sha256')
      report.add('evidence.android_video_review', 'unverified', 'Watch the public video with sound and enter its link in the Play Console foreground-service declaration. Publication is not Google approval.')
    rescue InvalidEvidence, JSON::ParserError
      report.add('evidence.android_video', 'failed', 'Evidence manifest or video failed integrity validation. Regenerate and review the recording before publishing.')
    end
  end
end
