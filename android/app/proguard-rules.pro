# Playback diagnostics must remain visible in release logcat (NoisePlayback).
# The default optimized rules retain Log.i; do not add an -assumenosideeffects
# rule that strips it. Verify NoisePlayback in release logcat when testing diagnostics.
