# frozen_string_literal: true

require 'dotenv'

# .secrets is a gitignored symlink to the store credentials shared with
# tearleads (see the README).
SECRETS_DIR = File.expand_path('../../.secrets', __dir__)

# Only what these lanes need: root.env also holds unrelated secrets.
STORE_SECRET_NAMES = {
  'root.env' => %w[
    APPLE_ID
    APP_STORE_CONNECT_ISSUER_ID
    APP_STORE_CONNECT_KEY_ID
    ITC_TEAM_ID
    MATCH_GIT_BASIC_AUTHORIZATION
    MATCH_GIT_URL
    MATCH_PASSWORD
    TEAM_ID
  ],
  'nc.env' => %w[NC_ANDROID_KEYSTORE_PASS]
}.freeze

GOOGLE_PLAY_JSON_KEY_PATH = File.join(SECRETS_DIR, 'google-play-service-account-admin.json')

# Values already in the environment win, so any of them can be overridden.
def load_store_secrets
  STORE_SECRET_NAMES.each do |file, names|
    path = File.join(SECRETS_DIR, file)
    UI.user_error!("Missing #{path}. Is the .secrets symlink set up?") unless File.file?(path)

    values = Dotenv.parse(path)
    names.each { |name| ENV[name] ||= values[name] if values.key?(name) }
  end
end

def required_env(name)
  value = ENV.fetch(name, '')
  UI.user_error!("#{name} is required (from .secrets or the environment).") if value.empty?

  value
end

def app_store_connect_api_key_options
  key_id = required_env('APP_STORE_CONNECT_KEY_ID')
  key_filepath = File.join(SECRETS_DIR, "AuthKey_#{key_id}.p8")
  UI.user_error!("Missing App Store Connect API key: #{key_filepath}") unless File.file?(key_filepath)

  { key_id: key_id, issuer_id: required_env('APP_STORE_CONNECT_ISSUER_ID'), key_filepath: key_filepath }
end
