# Playback diagnostics must remain visible in release logcat (NoisePlayback).
# The default optimized rules retain Log.i; do not add an -assumenosideeffects
# rule that strips it. The minified release UI check verifies the live stream.
