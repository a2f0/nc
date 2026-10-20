#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'tmpdir'
require 'tempfile'
require 'timeout'
require 'rexml/document'
require_relative '../fastlane/lib/play_evidence'

ROOT = File.expand_path('..', __dir__)
OUT = File.join(ROOT, '.store-evidence/android-media-playback')
SERIAL = 'emulator-5586'
AVD = 'NoiseConnoisseur_Evidence'
APP = 'net.a2f0.nc'
SDK = ENV['ANDROID_HOME'] || ENV['ANDROID_SDK_ROOT'] || File.join(Dir.home, 'Library/Android/sdk')
ENV['PATH'] = [File.join(SDK, 'platform-tools'), File.join(SDK, 'emulator'),
               File.join(SDK, 'cmdline-tools/latest/bin'), ENV['PATH']].join(File::PATH_SEPARATOR)
FileUtils.mkdir_p(OUT, mode: 0o700)
LOG = File.join(OUT, 'capture.log')

def run(*args, timeout: 120, input: nil)
  File.open(LOG, 'a') { |log| log.puts(args.join(' ')) }
  Tempfile.create('nc-video-command') do |out|
    Tempfile.create('nc-video-input') do |stdin|
      stdin.write(input.to_s)
      stdin.rewind
      pid = Process.spawn(*args, in: stdin.path, out: out.path, err: [LOG, 'a'], pgroup: true, chdir: ROOT)
      begin
        _, status = Timeout.timeout(timeout) { Process.wait2(pid) }
        raise "#{args.first} failed; see #{LOG}" unless status.success?
      rescue Timeout::Error
        Process.kill('KILL', -pid) rescue nil
        Process.wait(pid) rescue nil
        raise "#{args.first} timed out; see #{LOG}"
      end
      out.rewind
      out.read
    end
  end
end

def adb(*args)
  run('adb', '-s', SERIAL, *args)
end

def wait_until(seconds, description)
  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + seconds
  until yield
    raise "Timed out waiting for #{description}" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
    sleep 1
  end
end

def flow(name)
  run('maestro', '--device', SERIAL, 'test', '--test-output-dir', File.join(OUT, 'maestro'),
      File.join(ROOT, 'maestro/evidence', "#{name}.yaml"), timeout: 75)
end

def service
  adb('shell', 'dumpsys', 'activity', 'services', APP)
end

def rms(path, start, duration)
  samples = run('ffmpeg', '-v', 'error', '-ss', start.to_s, '-t', duration.to_s, '-i', path,
                '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-').unpack('e*')
  raise 'Audio segment missing' if samples.length < 8000
  Math.sqrt(samples.sum { |value| value * value } / samples.length)
end

artifact = File.expand_path(ARGV.fetch(0))
bundletool = File.expand_path(ARGV.fetch(1))
capture_source = Readiness.source(ROOT)
raise 'A clean checkout is required to record evidence' if capture_source['dirty']
source = PlayEvidence.artifact_source(artifact, ROOT)
raise "Missing bundletool: #{bundletool}" unless File.file?(bundletool)
%w[adb emulator avdmanager maestro scrcpy ffmpeg ffprobe java].each { |name| run('which', name) }
raise "#{SERIAL} is already in use; no device was changed" if run('adb', 'devices').lines.any? { |line| line.start_with?(SERIAL + "\t") }
run('adb', 'devices').lines.grep(/^emulator-\d+\s+device/).each do |line|
  name = run('adb', '-s', line.split.first, 'emu', 'avd', 'name').lines.first.to_s.strip
  raise "#{AVD} is already running; no device was changed" if name == AVD
end

unless run('emulator', '-list-avds').lines.map(&:strip).include?(AVD)
  run('avdmanager', '--silent', 'create', 'avd', '--name', AVD,
      '--package', ENV.fetch('ANDROID_EVIDENCE_SYSTEM_IMAGE', 'system-images;android-35;google_apis_playstore;arm64-v8a'),
      '--device', 'pixel_2', input: "no\n")
end

tool = ['java', '-jar', bundletool]
xml = run(*tool, 'dump', 'manifest', "--bundle=#{artifact}", '--module=base')
manifest = REXML::Document.new(xml).root
raise 'Wrong app or debuggable artifact' unless manifest.attributes['package'] == APP &&
                                                manifest.elements['application'].attributes['android:debuggable'] != 'true'
apks = File.join(OUT, 'candidate.apks')
run(*tool, 'build-apks', "--bundle=#{artifact}", "--output=#{apks}", '--mode=universal', '--overwrite',
    "--ks=#{File.join(Dir.home, '.android/debug.keystore')}", '--ks-key-alias=androiddebugkey',
    '--ks-pass=pass:android', '--key-pass=pass:android', timeout: 180)
require 'zip'
apk = File.join(OUT, 'candidate.apk')
Zip::File.open(apks) { |zip| File.binwrite(apk, zip.read('universal.apk')) }

emulator_pid = recorder = nil
begin
  emulator_pid = Process.spawn('emulator', '-avd', AVD, '-port', '5586', '-no-window', '-no-audio',
                              '-no-snapshot', '-no-boot-anim', out: [LOG, 'a'], err: [LOG, 'a'])
  wait_until(120, 'emulator boot') do
    begin
      adb('shell', 'getprop', 'sys.boot_completed').strip == '1'
    rescue StandardError
      false
    end
  end
  adb('uninstall', APP) rescue nil # Only this script's dedicated emulator.
  adb('install', apk)
  adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
  adb('shell', 'settings', 'put', 'system', 'show_touches', '1')
  adb('shell', 'cmd', 'uimode', 'night', 'no')
  adb('shell', 'cmd', 'locale', 'set-app-locales', APP, '--locales', 'en-US')
  adb('shell', 'cmd', 'media_session', 'volume', '--stream', '3', '--set', '12')
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP')
  adb('shell', 'wm', 'dismiss-keyguard')
  adb('shell', 'am', 'start', '-n', "#{APP}/.MainActivity")
  sleep 3
  raise 'Playback started without a user action' if service.include?('isForeground=true')

  raw = File.join(OUT, 'raw.mp4')
  FileUtils.rm_f(raw)
  recorder = Process.spawn('scrcpy', '--serial', SERIAL, '--no-playback', '--no-window', '--no-control',
                           '--require-audio', '--audio-source=output', '--audio-codec=aac', '--video-codec=h264',
                           '--max-size=1280', '--max-fps=30', '--video-bit-rate=2M', '--time-limit=150',
                           "--record=#{raw}", out: [LOG, 'a'], err: [LOG, 'a'])
  started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  sleep 3
  flow('start-playback')
  wait_until(10, 'media-playback foreground service') { service.match?(/isForeground=true.*types=0x0*2\b/) }
  File.write(File.join(OUT, 'playing-service.txt'), service, perm: 0o600)
  sleep 3
  flow('background-playback')
  raise 'Service stopped in background' unless service.match?(/isForeground=true.*types=0x0*2\b/)
  background_at = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
  File.write(File.join(OUT, 'background-service.txt'), service, perm: 0o600)
  sleep 6
  flow('stop-playback')
  wait_until(10, 'foreground service to stop') { !service.include?('isForeground=true') }
  sleep 3
  Process.kill('INT', recorder)
  _, status = Timeout.timeout(20) { Process.wait2(recorder) }
  recorder = nil
  raise 'Recorder failed' unless status.success?

  video = File.join(OUT, 'android-media-playback.mp4')
  # Keep the complete timeline and captured audio; only normalize grayscale/codec.
  run('ffmpeg', '-v', 'error', '-y', '-i', raw, '-map', '0:v:0', '-map', '0:a:0',
      '-vf', 'hue=s=0,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-preset', 'fast',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', video)
  info = JSON.parse(run('ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', video))
  duration = Float(info.fetch('format').fetch('duration'))
  raise 'Missing audio/video tracks' unless info['streams'].any? { |s| s['codec_name'] == 'aac' } &&
                                             info['streams'].any? { |s| s['codec_name'] == 'h264' }
  raise 'Background playback is not audible in the recording' unless rms(video, background_at + 1, 3) > 0.001
  raise 'Audio continued after Stop' unless rms(video, duration - 1.5, 1) < 0.0001
  raise 'AAB changed during capture' unless PlayEvidence.artifact_source(artifact, ROOT) == source
  raise 'Checkout changed during capture' unless Readiness.source(ROOT) == capture_source
  sha = Digest::SHA256.file(video).hexdigest
  data = {
    'schema_version' => 1, 'application_id' => APP, 'permission' => 'FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'recorded_at' => Time.now.utc.iso8601, 'source_commit' => source['commit'],
    'capture_commit' => capture_source['commit'],
    'device' => "Android #{adb('shell', 'getprop', 'ro.build.version.release').strip} emulator (#{AVD})",
    'version_name' => manifest.attributes['android:versionName'], 'version_code' => manifest.attributes['android:versionCode'],
    'aab_sha256' => Digest::SHA256.file(artifact).hexdigest, 'apk_sha256' => Digest::SHA256.file(apk).hexdigest,
    'apk_signing' => 'local debug key; APK generated from the release AAB with bundletool',
    'video_key' => "android-media-playback/#{sha}.mp4", 'video_sha256' => sha,
    'video_bytes' => File.size(video), 'duration_seconds' => duration, 'audio' => true,
    'verified_steps' => %w[user_start background_media_playback notification_stop]
  }
  PlayEvidence.validate(data)
  File.write(File.join(OUT, 'manifest.json'), JSON.pretty_generate(data) + "\n", perm: 0o600)
  puts "Recorded #{video} (#{duration.round(1)} seconds). Watch it with sound before publishing."
ensure
  if recorder
    Process.kill('INT', recorder) rescue nil
    Timeout.timeout(10) { Process.wait(recorder) } rescue Process.kill('KILL', recorder) rescue nil
  end
  if emulator_pid
    adb('shell', 'am', 'force-stop', APP) rescue nil
    adb('emu', 'kill') rescue nil
    Timeout.timeout(10) { Process.wait(emulator_pid) } rescue Process.kill('KILL', emulator_pid) rescue nil
  end
end
