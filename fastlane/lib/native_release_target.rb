# frozen_string_literal: true

require 'dotenv'

# Fastlane loads files without its UI constant in their scope.
def native_release_error!(message)
  FastlaneCore::UI.user_error!(message)
end

# The store apps the lanes release, keyed by tier. nc has only a production app,
# so this is just its identifier and the .secrets folder its credentials are in.
targets = {
  'production' => { app_identifier: 'net.a2f0.nc', secrets_tier: 'prod' }.freeze
}.freeze

# The Appfile reads the identifier too, so the tier comes from the environment
# rather than a lane option, and an unknown one fails before any lane runs.
# Fastlane loads this file again after that failure, so it checks the tier
# before defining any constant.
requested_tier = ENV.fetch('NATIVE_RELEASE_TIER', '').strip.downcase
tier = requested_tier.empty? ? 'production' : requested_tier
unless targets.key?(tier)
  native_release_error!("Unknown NATIVE_RELEASE_TIER #{tier.inspect}; nc declares #{targets.keys.join(', ')}.")
end

NATIVE_RELEASE_TARGETS = targets
NATIVE_RELEASE_TIER = tier
NATIVE_RELEASE_TARGET = NATIVE_RELEASE_TARGETS.fetch(NATIVE_RELEASE_TIER)
NATIVE_APP_IDENTIFIER = NATIVE_RELEASE_TARGET.fetch(:app_identifier)

REPO_ROOT = File.expand_path('../..', __dir__)

# .secrets is a gitignored symlink to this project's folder in matrix-secrets
# (see the README). NATIVE_RELEASE_SECRETS_DIR names another folder, as tests
# do; a relative one is resolved from the repository root.
secrets_override = ENV.fetch('NATIVE_RELEASE_SECRETS_DIR', '')
SECRETS_DIR = if secrets_override.empty?
                File.join(REPO_ROOT, '.secrets', NATIVE_RELEASE_TARGET.fetch(:secrets_tier))
              else
                File.expand_path(secrets_override, REPO_ROOT)
              end

# shared.env holds the values copied from the shared root.env that nc uses, and
# app.env nc's own. They load in that order, so app.env wins.
SECRETS_ENV_FILES = %w[shared.env app.env].freeze

# Only what each platform's lanes need; both files also hold unrelated values.
IOS_SECRETS = %w[
  APPLE_ID
  APP_STORE_CONNECT_ISSUER_ID
  APP_STORE_CONNECT_KEY_ID
  ITC_TEAM_ID
  MATCH_GIT_BASIC_AUTHORIZATION
  MATCH_GIT_URL
  MATCH_PASSWORD
  TEAM_ID
].freeze
ANDROID_SECRETS = %w[ANDROID_KEYSTORE_STORE_PASS ANDROID_KEYSTORE_KEY_PASS].freeze

GOOGLE_PLAY_JSON_KEY_PATH = File.join(SECRETS_DIR, 'google-play-service-account-admin.json')
ANDROID_KEYSTORE_PATH = File.join(SECRETS_DIR, 'nc-upload.keystore')

# Values already in the environment win, so any of them can be overridden.
def load_store_secrets(names)
  values = SECRETS_ENV_FILES.each_with_object({}) do |file, merged|
    path = File.join(SECRETS_DIR, file)
    native_release_error!("Missing #{path}. Is the .secrets symlink set up?") unless File.file?(path)

    merged.merge!(Dotenv.parse(path))
  end
  names.each { |name| ENV[name] ||= values[name] if values.key?(name) }
end

def required_env(name)
  value = ENV.fetch(name, '')
  native_release_error!("#{name} is required (from .secrets or the environment).") if value.empty?

  value
end

def app_store_connect_api_key_options
  key_id = required_env('APP_STORE_CONNECT_KEY_ID')
  key_filepath = File.join(SECRETS_DIR, "AuthKey_#{key_id}.p8")
  native_release_error!("Missing App Store Connect API key: #{key_filepath}") unless File.file?(key_filepath)

  { key_id: key_id, issuer_id: required_env('APP_STORE_CONNECT_ISSUER_ID'), key_filepath: key_filepath }
end
