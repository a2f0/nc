# Playback diagnostics must remain visible in release logcat (NoisePlayback).
# The default optimized rules retain Log.i; do not add an -assumenosideeffects
# rule that strips it. Verify NoisePlayback in release logcat when testing diagnostics.

# Glance runs a widget's actionRunCallback<T>() by creating T from its class name, and its
# own rules don't keep the constructor: without this, R8 removes StopNoiseAction's and the
# widget's Stop buttons fail with NoSuchMethodException in release builds.
-keep class * implements androidx.glance.appwidget.action.ActionCallback {
    <init>();
}
