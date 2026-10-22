# frozen_string_literal: true

# Just enough of fastlane to evaluate fastlane/Fastfile, and the lane files it
# imports, and run its lanes with recording stand-ins for every action, so tests
# see what each lane passes without signing or uploading anything. Needs only
# plain Ruby.

# What UI.user_error! raises.
class UserError < StandardError; end

# Fastlane's UI, reduced to raising user errors and discarding messages.
module UI
  def self.user_error!(message) = raise(UserError, message)
  def self.message(_text) = nil
  def self.success(_text) = nil
  def self.important(_text) = nil
end

module FastlaneCore
  # Fastlane defines UI only in its own namespaces, so required files use this one.
  UI = ::UI

  # Keychain paths as fastlane resolves them, under a fixed fake folder.
  module Helper
    def self.keychain_path(name) = "/keychains/#{name}-db"
  end
end

# create_app sets up the App Group through the Developer Portal; tests read the
# calls it makes from events.
module Spaceship
  # Records the Developer Portal calls create_app makes in events.
  module Portal
    class << self
      attr_accessor :events, :groups

      def login(username) = events << ['login', username]
      def select_team(team_id:) = events << ['select_team', team_id]
      def app_group = AppGroups
      def app = Apps
    end

    # App Groups, held in Portal.groups.
    module AppGroups
      def self.find(group_id) = Portal.groups[group_id]

      def self.create!(group_id:, name:)
        Portal.events << ['create_app_group', group_id, name]
        Portal.groups[group_id] = group_id
      end
    end

    # Apps, each recording the groups it joins.
    module Apps
      def self.find(identifier) = App.new(identifier)
    end

    App = Struct.new(:identifier) do
      def associate_groups(groups) = Portal.events << ['associate_groups', identifier, groups]
    end
  end
end

# Evaluates a Fastfile like fastlane does, recording each action call.
class FakeFastfile
  # stubs maps each action the lanes may call to a callable returning its result.
  def initialize(path, stubs)
    @stubs = stubs
    @calls = []
    @lanes = Hash.new { |lanes, platform| lanes[platform] = {} }
    @fastfile = path
    instance_eval(File.read(path), path)
  end

  def run_lane(platform, name, options = {})
    previous = @platform
    @platform = platform
    @lanes.fetch(platform).fetch(name).call(options)
  ensure
    @platform = previous
  end

  def calls_to(action) = @calls.select { |name, _| name == action }.map(&:last)

  # Each platform's lanes, in the order they're defined.
  def lane_names = @lanes.transform_values(&:keys)

  # Replaces a helper method the Fastfile defines.
  def stub_method(name, &) = define_singleton_method(name, &)

  private

  def default_platform(_platform) = nil
  def skip_docs = nil
  def desc(_text) = nil

  # Like fastlane, resolves a relative path from the Fastfile's folder and
  # evaluates the file in the same context, so its lanes and helpers join the rest.
  def import(path)
    path = File.expand_path(path, File.dirname(@fastfile))
    instance_eval(File.read(path), path)
  end

  def platform(name)
    @defining = name
    yield
  ensure
    @defining = nil
  end

  def lane(name, &block)
    @lanes[@defining][name] = block
  end

  # Lanes call other lanes of their platform, and actions, by name.
  def method_missing(name, *args, **kwargs)
    return run_lane(@platform, name, *args) if @platform && @lanes[@platform].key?(name)
    return super unless @stubs.key?(name)

    @calls << [name, kwargs.empty? ? args : kwargs]
    @stubs.fetch(name).call(*args, **kwargs)
  end

  def respond_to_missing?(name, include_private = false) = @stubs.key?(name) || super
end
