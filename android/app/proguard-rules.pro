# Playback diagnostics must remain visible in release logcat (NoisePlayback).
# Do not declare Log.i side-effect-free.
-keep class android.util.Log {
    public static int i(java.lang.String, java.lang.String);
}
