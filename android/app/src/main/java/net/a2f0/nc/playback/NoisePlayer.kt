package net.a2f0.nc.playback

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.glance.appwidget.updateAll
import net.a2f0.nc.NoiseType
import net.a2f0.nc.widget.NoiseWidget
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** App-wide entry point for controlling playback and observing what's playing. */
object NoisePlayer {
    private val _nowPlaying = MutableStateFlow<NoiseType?>(null)

    /** The noise currently playing, or null when stopped. */
    val nowPlaying: StateFlow<NoiseType?> = _nowPlaying.asStateFlow()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private const val PREFERENCES = "playback"
    private const val VOLUME_KEY = "volume"
    private const val LAST_PLAYED_KEY = "lastPlayed"

    /** What's saved across launches, loaded from preferences on first use, which needs a Context. */
    private class Saved(preferences: SharedPreferences) {
        val volume = MutableStateFlow(preferences.getFloat(VOLUME_KEY, 1f))
        val lastPlayed = MutableStateFlow(NoiseType.fromId(preferences.getString(LAST_PLAYED_KEY, null)) ?: NoiseType.WHITE)
    }

    @Volatile private var loaded: Saved? = null

    private fun saved(context: Context): Saved =
        loaded ?: synchronized(this) {
            loaded ?: Saved(preferences(context)).also { loaded = it }
        }

    private fun preferences(context: Context) =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    /** The app's own volume, from 0 to 1, on top of the system volume. Saved across launches. */
    fun volume(context: Context): StateFlow<Float> = saved(context).volume

    fun setVolume(context: Context, volume: Float) {
        val clamped = volume.coerceIn(0f, 1f)
        saved(context).volume.value = clamped
        preferences(context).edit { putFloat(VOLUME_KEY, clamped) }
    }

    /**
     * The most recently played noise, which the play button and headset or lock screen
     * controls resume. Saved across launches.
     */
    fun lastPlayed(context: Context): StateFlow<NoiseType> = saved(context).lastPlayed

    fun play(context: Context, type: NoiseType) {
        ContextCompat.startForegroundService(context, PlaybackService.playIntent(context, type))
    }

    fun stop(context: Context) {
        // Only a running (foreground) service can be playing, so this never starts one from the background.
        if (_nowPlaying.value != null) {
            context.startService(PlaybackService.stopIntent(context))
        }
    }

    fun toggle(context: Context, type: NoiseType) {
        if (_nowPlaying.value == type) stop(context) else play(context, type)
    }

    /** Stops what's playing, or plays the last noise again. */
    fun togglePlayback(context: Context) {
        toggle(context, _nowPlaying.value ?: lastPlayed(context).value)
    }

    internal fun update(context: Context, type: NoiseType?) {
        if (type != null) {
            saved(context).lastPlayed.value = type
            preferences(context).edit { putString(LAST_PLAYED_KEY, type.id) }
        }
        if (_nowPlaying.value == type) return
        _nowPlaying.value = type
        val appContext = context.applicationContext
        scope.launch { NoiseWidget().updateAll(appContext) }
    }
}
