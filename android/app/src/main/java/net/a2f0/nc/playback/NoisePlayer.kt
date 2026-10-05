package net.a2f0.nc.playback

import android.content.Context
import androidx.core.content.ContextCompat
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

    /** The most recently played noise; used when resuming from headset or lock screen controls. */
    var lastPlayed: NoiseType = NoiseType.WHITE
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

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

    internal fun update(context: Context, type: NoiseType?) {
        if (type != null) lastPlayed = type
        if (_nowPlaying.value == type) return
        _nowPlaying.value = type
        val appContext = context.applicationContext
        scope.launch { NoiseWidget().updateAll(appContext) }
    }
}
