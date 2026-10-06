# frozen_string_literal: true

require 'fileutils'

# Stages store listing uploads. The text is committed under fastlane/metadata;
# screenshots and Play graphics are generated into the gitignored .screenshots/
# (scripts/takeScreenshots.sh, scripts/buildStoreImages.sh), so the lanes copy
# them into a temporary directory laid out the way deliver and supply expect.
module StoreListing
  LOCALE = 'en-US'
  IOS_DEVICES = %w[iphone ipad].freeze

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
    files = Dir[File.join(dir, '*.png')].sort
    raise "No screenshots in #{dir}. Run scripts/takeScreenshots.sh first." if files.empty?

    files
  end
end
