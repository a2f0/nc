# frozen_string_literal: true

# Stands in for the dotenv gem, which plain Ruby (as in CI's lint job) lacks.
module Dotenv
  def self.parse(path)
    File.readlines(path, chomp: true).filter_map do |line|
      next if line.start_with?('#') || !line.include?('=')

      line.delete_prefix('export ').split('=', 2)
    end.to_h
  end
end
