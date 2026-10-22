package net.a2f0.nc.playback

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.drawable.Icon
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.a2f0.nc.LanguagePreferences
import net.a2f0.nc.MainActivity
import net.a2f0.nc.NoiseType
import net.a2f0.nc.R
import net.a2f0.nc.audio.NoiseEngine
import net.a2f0.nc.audio.PlaybackEngine
import net.a2f0.nc.history.ListeningHistory
import net.a2f0.nc.diagnostics.PlaybackLog
import net.a2f0.nc.diagnostics.PlaybackEvent

/**
 * Foreground media service that keeps noise playing while the app is in the background.
 * Owns the audio engine, audio focus, the media session (lock screen / headset controls),
 * and the playback notification.
 */
open class PlaybackService : Service() {
    private val log by lazy { PlaybackLog.get(this) }
    private val engine by lazy {
        createEngine(
            onStarted = { type ->
                scope.launch {
                    if (nowPlaying == type && !pausedForFocusLoss) {
                        ListeningHistory.get(this@PlaybackService).transition(type.id)
                        log.record(PlaybackEvent.STARTED, type, activeSound = type.id, updateActive = true)
                    }
                }
            },
            onFailed = { failure -> scope.launch {
                log.record(PlaybackEvent.ENGINE_FAILED, nowPlaying, failure)
                stop("engine_failed")
            } },
        )
    }
    private val scope = MainScope()
    private lateinit var audioManager: AudioManager
    private lateinit var focusRequest: AudioFocusRequest
    private lateinit var session: MediaSession
    private var nowPlaying: NoiseType? = null
    private var pausedForFocusLoss = false

    private val becomingNoisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                log.record(PlaybackEvent.NOISY, nowPlaying)
                stop("audio_becoming_noisy")
            }
        }
    }
    private var noisyReceiverRegistered = false

    internal open fun createEngine(onStarted: (NoiseType) -> Unit, onFailed: (String) -> Unit): PlaybackEngine =
        NoiseEngine(onStarted = onStarted, onFailed = onFailed)

    private val languageListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == LanguagePreferences.KEY) refreshLanguage()
    }

    override fun onCreate() {
        super.onCreate()
        PlaybackLog.get(this)
        val history = ListeningHistory.get(this)
        scope.launch {
            while (true) {
                delay(15_000)
                if (nowPlaying != null && !pausedForFocusLoss) history.checkpoint()
            }
        }
        val volume = NoisePlayer.volume(this)
        engine.setVolume(volume.value)
        scope.launch { volume.collect(engine::setVolume) }
        audioManager = getSystemService(AudioManager::class.java)
        focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(NoiseEngine.ATTRIBUTES)
            .setOnAudioFocusChangeListener(::onAudioFocusChange)
            .build()
        session = MediaSession(this, "NoiseConnoisseur").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = play(nowPlaying ?: NoisePlayer.lastPlayed(this@PlaybackService).value, "media_play")
                override fun onPause() = stop("media_pause", requested = true)
                override fun onStop() = stop("media_stop", requested = true)
            })
        }
        createNotificationChannel()
        LanguagePreferences.preferences(this).registerOnSharedPreferenceChangeListener(languageListener)
    }

    // Changing the language doesn't restart the service, so relabel what it shows.
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        refreshLanguage()
        NoisePlayer.refreshWidgets(this)
    }

    private fun refreshLanguage() {
        createNotificationChannel()
        nowPlaying?.let { type ->
            showNotification(type)
            session.setMetadata(metadata(type))
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> play(NoiseType.fromId(intent.getStringExtra(EXTRA_NOISE)) ?: NoisePlayer.lastPlayed(this).value, intent.getStringExtra(EXTRA_SOURCE) ?: "unknown")
            else -> stop(intent?.getStringExtra(EXTRA_SOURCE) ?: "unknown", requested = true)
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // Swiping the app away from Recents quits it, as on iOS. A foreground service
    // would otherwise outlive the task and keep playing.
    override fun onTaskRemoved(rootIntent: Intent?) {
        log.record(PlaybackEvent.TASK_REMOVED, nowPlaying)
        stop("task_removed")
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        log.record(PlaybackEvent.SERVICE_DESTROYED, nowPlaying, updateActive = true)
        LanguagePreferences.preferences(this).unregisterOnSharedPreferenceChangeListener(languageListener)
        scope.cancel()
        engine.stop()
        ListeningHistory.get(this).transition(null)
        audioManager.abandonAudioFocusRequest(focusRequest)
        unregisterNoisyReceiver()
        session.release()
        NoisePlayer.update(this, null)
        super.onDestroy()
    }

    private fun play(type: NoiseType, source: String) {
        log.record(PlaybackEvent.PLAY_REQUESTED, type, source)
        // Must be called promptly after startForegroundService(), even if we end up not playing.
        showNotification(type)
        if (audioManager.requestAudioFocus(focusRequest) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            log.record(PlaybackEvent.FOCUS_DENIED, type)
            stop("focus_denied")
            return
        }
        pausedForFocusLoss = false
        if (nowPlaying != type) ListeningHistory.get(this).transition(null)
        nowPlaying = type
        engine.play(type)
        registerNoisyReceiver()

        session.setMetadata(metadata(type))
        session.setPlaybackState(playbackState(PlaybackState.STATE_PLAYING))
        session.isActive = true
        NoisePlayer.update(this, type)
    }

    private fun stop(reason: String, requested: Boolean = false) {
        if (requested) log.record(PlaybackEvent.STOP_REQUESTED, nowPlaying, reason)
        log.record(PlaybackEvent.STOPPED, nowPlaying, reason, updateActive = true)
        engine.stop()
        ListeningHistory.get(this).transition(null)
        audioManager.abandonAudioFocusRequest(focusRequest)
        unregisterNoisyReceiver()
        nowPlaying = null
        session.setPlaybackState(playbackState(PlaybackState.STATE_STOPPED))
        session.isActive = false
        NoisePlayer.update(this, null)
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun onAudioFocusChange(change: Int) {
        val reason = when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> "AUDIOFOCUS_LOSS"
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> "AUDIOFOCUS_LOSS_TRANSIENT"
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> "AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK"
            AudioManager.AUDIOFOCUS_GAIN -> "AUDIOFOCUS_GAIN"
            else -> "AUDIOFOCUS_$change"
        }
        log.record(PlaybackEvent.FOCUS_CHANGED, nowPlaying, reason)
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> stop("audiofocus_loss")
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> if (nowPlaying != null) {
                log.record(PlaybackEvent.STOPPED, nowPlaying, "audiofocus_loss_transient", updateActive = true)
                pausedForFocusLoss = true
                engine.stop()
                ListeningHistory.get(this).transition(null)
                session.setPlaybackState(playbackState(PlaybackState.STATE_PAUSED))
            }
            AudioManager.AUDIOFOCUS_GAIN -> if (pausedForFocusLoss) {
                pausedForFocusLoss = false
                nowPlaying?.let {
                    engine.play(it)
                    session.setPlaybackState(playbackState(PlaybackState.STATE_PLAYING))
                }
            }
            // AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK: the system ducks our volume automatically.
        }
    }

    private fun playbackState(state: Int): PlaybackState = PlaybackState.Builder()
        .setActions(
            PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
                PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP,
        )
        .setState(state, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
        .build()

    /** Puts the service in the foreground with the playback notification, or updates the notification. */
    private fun showNotification(type: NoiseType) {
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(type),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
        )
    }

    private fun metadata(type: NoiseType): MediaMetadata {
        val context = LanguagePreferences.localized(this)
        return MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, context.getString(type.title))
            .putString(MediaMetadata.METADATA_KEY_ARTIST, context.getString(R.string.app_name))
            .build()
    }

    /** Creates the playback channel, or renames it for the current language. */
    private fun createNotificationChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                LanguagePreferences.localized(this).getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
    }

    private fun buildNotification(type: NoiseType): Notification {
        val context = LanguagePreferences.localized(this)
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val stopAction = Notification.Action.Builder(
            Icon.createWithResource(this, R.drawable.ic_stop),
            context.getString(R.string.stop),
            PendingIntent.getService(this, 0, stopIntent(this, "notification"), PendingIntent.FLAG_IMMUTABLE),
        ).build()

        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(type.title))
            .setContentText(context.getString(R.string.app_name))
            .setContentIntent(openApp)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(stopAction)
            .setStyle(
                Notification.MediaStyle()
                    .setMediaSession(session.sessionToken)
                    .setShowActionsInCompactView(0),
            )
            .build()
    }

    private fun registerNoisyReceiver() {
        if (noisyReceiverRegistered) return
        ContextCompat.registerReceiver(
            this,
            becomingNoisyReceiver,
            IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        noisyReceiverRegistered = true
    }

    private fun unregisterNoisyReceiver() {
        if (!noisyReceiverRegistered) return
        unregisterReceiver(becomingNoisyReceiver)
        noisyReceiverRegistered = false
    }

    companion object {
        private const val ACTION_PLAY = "net.a2f0.nc.action.PLAY"
        private const val ACTION_STOP = "net.a2f0.nc.action.STOP"
        private const val EXTRA_SOURCE = "source"
        private const val EXTRA_NOISE = "noise"
        private const val CHANNEL_ID = "playback"
        private const val NOTIFICATION_ID = 1

        fun playIntent(context: Context, type: NoiseType, source: String = "ui"): Intent =
            Intent(context, PlaybackService::class.java)
                .setAction(ACTION_PLAY)
                .putExtra(EXTRA_NOISE, type.id)
                .putExtra(EXTRA_SOURCE, source)

        fun stopIntent(context: Context, source: String = "ui"): Intent =
            Intent(context, PlaybackService::class.java).setAction(ACTION_STOP).putExtra(EXTRA_SOURCE, source)
    }
}
