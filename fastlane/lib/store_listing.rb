# frozen_string_literal: true

require 'fileutils'
require 'json'

# Stages store listing uploads. The text is committed under fastlane/metadata;
# screenshots are captured into the gitignored .screenshots (`bun run screenshots`),
# usually a link to the matrix store every clone shares, so the lanes copy them into a
# temporary directory laid out the way deliver and supply expect. The Play lane renders
# its graphics there too (the store target in agent-tool.json, via
# scripts/build/buildImages.sh).
module StoreListing
  LOCALE = 'en-US'
  IOS_DEVICES = %w[iphone ipad].freeze
  CAPTURE_RECORD = 'capture.json'

  # Runs the block that copies a platform's screenshots only from a finished capture of
  # a commit that took that platform and that no capture overlapped, and returns its
  # value. A shared capture writes a `running` capture.json before it touches an image,
  # so an unchanged record on both sides of the copy proves none started meanwhile.
  # Without a record, a plain folder (CI, or a clone not yet linked) copies as it is, but
  # a linked, non-empty store doesn't: its images have no known commit.
  def self.with_shared_capture(screenshots_dir, platform:, announce: ->(line) { puts line })
    before = read_capture(screenshots_dir)
    if before.nil? && File.symlink?(screenshots_dir) && !Dir.empty?(screenshots_dir)
      raise 'The shared screenshots have no capture record; capture once through the take-screenshots skill.'
    end

    announce.call(capture_provenance(before, platform)) if before
    result = yield
    unless read_capture(screenshots_dir) == before
      raise 'A screenshot capture started while copying the screenshots; upload again once it finishes.'
    end

    result
  end

  def self.capture_provenance(raw, platform)
    record = JSON.parse(raw)
    args = Array(record['args'])
    check_capture(record, args, platform)
    partial = args.empty? ? '' : " (partial: #{args.join(' ')})"
    "Screenshots from #{record['commit'].to_s[0, 10]}, captured #{record['finishedAt']}#{partial}."
  end

  def self.check_capture(record, args, platform)
    unless record['status'] == 'complete'
      raise "The shared screenshot capture is #{record['status']}; wait for it or recapture."
    end
    raise 'The shared screenshots were captured from uncommitted changes; recapture from a commit.' if record['dirty']
    # `bun run screenshots ios` leaves the Android screenshots from an earlier capture;
    # takeScreenshots.sh reads only its first argument.
    return if [nil, 'all', platform].include?(args.first)

    raise "The shared capture took only #{args.first}; capture #{platform} before uploading its screenshots."
  end

  def self.read_capture(screenshots_dir)
    File.read(File.join(screenshots_dir, CAPTURE_RECORD))
  rescue Errno::ENOENT
    nil
  end

  # deliver takes one folder of screenshots per locale and tells iPhone from iPad
  # by size. Prefixing the device keeps same-named captures apart and in order.
  def self.stage_ios_screenshots(screenshots_dir, output_dir)
    target = File.join(output_dir, LOCALE)
    FileUtils.mkdir_p(target)
    IOS_DEVICES.each do |device|
      screenshots(File.join(screenshots_dir, 'ios', device)).each do |file|
        FileUtils.cp(file, File.join(target, "#{device}-#{File.basename(file)}"))
      end
    end
    output_dir
  end

  # supply reads <locale>/*.txt and <locale>/images/. Returns the images folder,
  # where the caller adds icon.png and featureGraphic.png.
  def self.stage_play_listing(metadata_dir, screenshots_dir, output_dir)
    FileUtils.cp_r(File.join(metadata_dir, '.'), output_dir)
    images = File.join(output_dir, LOCALE, 'images')
    phone = File.join(images, 'phoneScreenshots')
    FileUtils.mkdir_p(phone)
    FileUtils.cp(screenshots(File.join(screenshots_dir, 'android', 'phone')), phone)
    images
  end

  def self.screenshots(dir)
    files = Dir[File.join(dir, '*.png')]
    raise "No screenshots in #{dir}. Run bun run screenshots first." if files.empty?

    files
  end
end
