# frozen_string_literal: true

require 'digest'
require 'fileutils'
require 'json'
require 'open3'
require 'time'

# Evidence is tied to artifact bytes, never inferred from whichever checkout happens
# to be open during an audit. Reports intentionally omit store contacts and raw errors.
module Readiness
  class CommandError < StandardError; end

  def self.command(*args)
    out, _err, status = Open3.capture3({ 'LC_ALL' => 'C' }, *args)
    raise CommandError, "#{File.basename(args.first)} failed" unless status.success?
    out
  end

  def self.source(root)
    { 'commit' => command('git', '-C', root, 'rev-parse', 'HEAD').strip,
      'dirty' => !command('git', '-C', root, 'status', '--porcelain').strip.empty? }
  end

  def self.record_build(artifact, source, root: nil)
    source = source.merge('dirty' => true) if root && source != self.source(root)
    data = { 'schema_version' => 1, 'sha256' => Digest::SHA256.file(artifact).hexdigest,
             'source' => source, 'built_at' => Time.now.utc.iso8601 }
    File.write("#{artifact}.build.json", JSON.pretty_generate(data) + "\n", perm: 0o600)
  end

  class Report
    attr_reader :data

    def initialize(platform, artifact, root)
      @data = { schema_version: 1, platform: platform, audited_at: Time.now.utc.iso8601,
                checkout: Readiness.source(root), artifact: { name: File.basename(artifact) }, checks: [] }
      if File.file?(artifact)
        @data[:artifact][:sha256] = Digest::SHA256.file(artifact).hexdigest
        check('artifact.exists', true, 'Artifact is present.')
        provenance(artifact)
      else
        check('artifact.exists', false, 'Build the release artifact or pass artifact:/absolute/path.')
      end
    end

    def add(id, status, detail)
      @data[:checks] << { id: id, status: status, detail: detail }
    end

    def check(id, passed, detail)
      add(id, passed ? 'verified' : 'failed', detail)
    end

    # Authentication/network/tool errors must leave a report, never a false pass.
    def attempt(id)
      yield
    rescue StandardError => error
      add(id, 'unverified', "Could not complete check (#{error.class.name}); check credentials, tools, and connectivity locally.")
    end

    def result
      statuses = @data[:checks].map { |check| check[:status] }
      return 'not_ready' if statuses.include?('failed')
      statuses.include?('unverified') ? 'incomplete' : 'ready_within_tested_scope'
    end

    def write(path)
      @data[:result] = result
      FileUtils.mkdir_p(File.dirname(path), mode: 0o700)
      File.write(path, JSON.pretty_generate(@data) + "\n", perm: 0o600)
      File.chmod(0o600, path)
    end

    private

    def provenance(artifact)
      receipt = "#{artifact}.build.json"
      unless File.file?(receipt)
        add('artifact.provenance', 'unverified', 'No build receipt. Rebuild with the release lane to identify the source commit.')
        return
      end
      attempt('artifact.provenance') do
        build = JSON.parse(File.read(receipt))
        valid = build['schema_version'] == 1 && build['sha256'] == @data[:artifact][:sha256] &&
                build.dig('source', 'commit').to_s.match?(/\A[0-9a-f]{40}\z/) &&
                [true, false].include?(build.dig('source', 'dirty'))
        check('artifact.provenance', valid, 'Build receipt must match the artifact SHA-256 and identify its source.')
        if valid
          @data[:artifact][:build] = { 'source' => build['source'].slice('commit', 'dirty'), 'built_at' => build['built_at'] }
          check('artifact.clean_source', !build['source']['dirty'], 'A release candidate must be built from a clean checkout.')
          check('artifact.current_commit', build['source']['commit'] == @data[:checkout]['commit'] && !@data[:checkout]['dirty'], 'Artifact source must match the audited clean checkout.')
        end
      end
    end
  end

  def self.manual_checks(report)
    report.add('manual.accessibility_devices', 'unverified', 'Run VoiceOver/TalkBack and physical-device audio, interruptions, routes, widgets, and upgrade tests against this candidate.')
    report.add('console.declarations', 'unverified', 'Confirm privacy/Data safety, ratings, agreements, pricing, availability, export/trader declarations, and Play production eligibility where applicable.')
    report.add('policy.current_requirements', 'unverified', 'Recheck current Apple SDK and Google target API requirements; artifact versions below are evidence, not a permanently current policy verdict.')
  end
end
