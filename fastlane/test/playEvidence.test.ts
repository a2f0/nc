import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const script = String.raw`
require 'tmpdir'
require 'fake_fastlane'
require File.join(ARGV[0], 'fastlane/lib/play_evidence')
result = {}
Dir.mktmpdir do |dir|
  artifact = File.join(dir, 'candidate.aab')
  video = File.join(dir, 'android-media-playback.mp4')
  path = File.join(dir, 'manifest.json')
  File.write(artifact, 'candidate')
  File.write(video, 'video fixture')
  sha = Digest::SHA256.file(video).hexdigest
  data = { 'schema_version' => 1, 'application_id' => 'net.a2f0.nc',
    'permission' => 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'source_commit' => 'a' * 40, 'capture_commit' => 'b' * 40,
    'version_name' => '1.0', 'version_code' => '16', 'recorded_at' => Time.now.utc.iso8601,
    'aab_sha256' => Digest::SHA256.file(artifact).hexdigest, 'apk_sha256' => 'a' * 64,
    'video_sha256' => sha, 'video_key' => "android-media-playback/#{sha}.mp4",
    'video_bytes' => File.size(video), 'audio' => true, 'duration_seconds' => 30,
    'verified_steps' => %w[user_start background_media_playback notification_stop] }
  File.write(path, JSON.generate(data))
  Readiness.define_singleton_method(:source) { |_| { 'commit' => 'a' * 40, 'dirty' => false } }
  report = -> { Readiness::Report.new('android', artifact, dir) }
  PlayEvidence.define_singleton_method(:fetch) { |*| raise 'network called' }
  offline = report.call
  PlayEvidence.check(offline, artifact, online: false)
  result[:offline] = offline.data[:checks]
  good = report.call
  PlayEvidence.check(good, artifact, manifest_path: path, online: false)
  result[:good] = good.data[:checks]
  File.write(artifact, 'new candidate')
  stale = report.call
  PlayEvidence.check(stale, artifact, manifest_path: path)
  result[:stale] = stale.data[:checks]
  File.write(artifact, 'candidate')

  # Exercise the actual publishing lane while intercepting all remote writes.
  lanes = FakeFastfile.new(File.join(ARGV[0], 'fastlane/Fastfile'), sh: ->(*) {})
  begin
    lanes.run_lane(:android, :publish_foreground_service_video, manifest: path, artifact: artifact)
  rescue UserError
    result[:review_required] = lanes.calls_to(:sh).empty?
  end
  lanes.run_lane(:android, :publish_foreground_service_video, manifest: path, artifact: artifact, reviewed: true)
  result[:puts] = lanes.calls_to(:sh)
  File.write(artifact, 'new candidate')
  begin
    lanes.run_lane(:android, :publish_foreground_service_video, manifest: path, artifact: artifact, reviewed: true)
  rescue UserError
    result[:stale_publish_rejected] = lanes.calls_to(:sh).length == 2
  end
  File.write(video, 'corrupt')
  corrupt = report.call
  PlayEvidence.check(corrupt, artifact, manifest_path: path)
  result[:corrupt] = corrupt.data[:checks]

  # Online inspection binds downloaded bytes to the pointer and to the candidate.
  File.write(artifact, 'candidate')
  requests = []
  PlayEvidence.define_singleton_method(:fetch) do |url, _limit|
    requests << url
    url.end_with?('.json') ? JSON.generate(data) : 'video fixture'
  end
  online = report.call
  PlayEvidence.check(online, artifact)
  result[:online] = online.data[:checks]
  result[:requests] = requests
end
puts JSON.generate(result)
`;
const child = Bun.spawnSync(["ruby", "-I", resolve(import.meta.dir, "support"), "-e", script, root], { stdout: "pipe", stderr: "pipe" });
if (child.exitCode !== 0) throw new Error(child.stderr.toString());
const result = JSON.parse(child.stdout.toString());
type Check = { id: string; status: string };
const status = (run: string, id: string) => result[run].find((c: Check) => c.id === `evidence.android_video${id}`)?.status;

test("evidence readiness verifies bytes and rejects a different candidate", () => {
  expect(status("offline", "")).toBe("unverified");
  expect(status("good", "_hash")).toBe("verified");
  expect(status("good", "_candidate")).toBe("verified");
  expect(status("stale", "_candidate")).toBe("failed");
  expect(status("corrupt", "")).toBe("unverified");
  expect(status("corrupt", "_hash")).toBeUndefined();
  expect(status("good", "_review")).toBe("unverified");
});
test("online readiness fetches the immutable video referenced by the manifest", () => {
  expect(status("online", "_candidate")).toBe("verified");
  expect(result.requests).toEqual([
    "https://nc.a2f0.net/review/android-media-playback.json",
    expect.stringMatching(/^https:\/\/nc\.a2f0\.net\/review\/android-media-playback\/[a-f0-9]{64}\.mp4$/),
  ]);
});
test("publication requires review and a matching artifact, uploading the pointer last", () => {
  expect(result.review_required).toBe(true);
  expect(result.stale_publish_rejected).toBe(true);
  expect(result.puts).toHaveLength(2);
  expect(result.puts[0]).toEqual(expect.arrayContaining(["--remote", "video/mp4", expect.stringMatching(/^nc-store-evidence\/android-media-playback\/[a-f0-9]{64}\.mp4$/)]));
  expect(result.puts[1]).toEqual(expect.arrayContaining(["--remote", "application/json", "nc-store-evidence/android-media-playback/current.json"]));
});
