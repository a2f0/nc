# frozen_string_literal: true

# Helpers both platforms' lanes use.

require_relative '../lib/native_release_target'
require_relative '../lib/readiness'

# Listing text is committed under fastlane/metadata; screenshots are generated
# here (see StoreListing).
SCREENSHOTS_DIR = File.join(REPO_ROOT, '.screenshots')

def release_source
  Readiness.source(REPO_ROOT)
rescue Readiness::CommandError, Errno::ENOENT
  UI.user_error!('Could not read build source with git; install git and run from the repository checkout.')
end

# The locales with a listing: the metadata folders that have the required file.
def listing_locales(metadata_dir, required_file)
  Dir.children(metadata_dir).select { |entry| File.file?(File.join(metadata_dir, entry, required_file)) }.sort
end

def readiness_options(options, platform, default_artifact)
  artifact = File.expand_path(options.fetch(:artifact, default_artifact), REPO_ROOT)
  output = File.expand_path(options.fetch(:output, ".readiness/#{platform}.json"), REPO_ROOT)
  if [artifact, "#{artifact}.build.json"].include?(output)
    UI.user_error!('Report output must not overwrite its artifact or build receipt')
  end
  [artifact, output]
end

def finish_readiness(report, output, options)
  Readiness.manual_checks(report)
  report.write(output)
  UI.message("Readiness: #{report.result}; report: #{output}")
  print_readiness_checks(report)
  if options[:strict].to_s == 'true' && report.result != 'ready_within_tested_scope'
    UI.user_error!("Readiness is #{report.result}; see #{output}")
  end
  report.data
end

def print_readiness_checks(report)
  report.data[:checks].each { |check| UI.message("#{check[:status]} #{check[:id]}: #{check[:detail]}") }
end
