# frozen_string_literal: true

# Picks the next Google Play version code from the codes already on each track.
module PlayVersionCode
  # Only a missing app or track counts as "no version codes yet". Any other
  # failure (auth, network) could hide the highest code and produce a duplicate.
  MISSING = /not found/i

  # Yields each track to fetch its version codes, and calls on_missing with the
  # track and error when the app or track doesn't exist yet.
  def self.next_code(tracks, on_missing: ->(_track, _error) {})
    codes = tracks.flat_map do |track|
      yield(track)
    rescue StandardError => e
      raise unless e.message.match?(MISSING)

      on_missing.call(track, e)
      []
    end
    (codes.map(&:to_i).max || 0) + 1
  end
end
