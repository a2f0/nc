package net.a2f0.nc.playback

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.os.Looper
import net.a2f0.nc.Language
import net.a2f0.nc.LanguagePreferences
import net.a2f0.nc.MainActivity
import net.a2f0.nc.NoiseType
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowMediaSession
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
class PlaybackServiceTest {
    private val context = RuntimeEnvironment.getApplication()
    private var controller: ServiceController<PlaybackService>? = null

    /** Starts pink noise the way the app and widget do, through the service's play intent. */
    private fun playPinkNoise(): PlaybackService {
        val started = Robolectric
            .buildService(PlaybackService::class.java, PlaybackService.playIntent(context, NoiseType.PINK))
            .create()
            .startCommand(0, 1)
        controller = started
        return started.get()
    }

    @After
    fun destroyService() {
        controller?.destroy()
    }

    @Test
    fun keepsPlayingInTheForegroundUntilStopped() {
        // Going Home or locking the screen leaves the service alone.
        val service = playPinkNoise()

        assertEquals(NoiseType.PINK, NoisePlayer.nowPlaying.value)
        assertNotNull(shadowOf(service).lastForegroundNotification)
        assertFalse(shadowOf(service).isForegroundStopped)
        assertFalse(shadowOf(service).isStoppedBySelf)
    }

    @Test
    fun swipingTheAppAwayFromRecentsStopsPlayback() {
        val service = playPinkNoise()

        service.onTaskRemoved(Intent(context, MainActivity::class.java))

        assertNull(NoisePlayer.nowPlaying.value)
        assertTrue(shadowOf(service).isForegroundStopped)
        assertTrue("the playback notification is removed", shadowOf(service).notificationShouldRemoved)
        assertTrue(shadowOf(service).isStoppedBySelf)
    }

    @Test
    fun savesTheLastNoisePlayed() {
        playPinkNoise()

        assertEquals(NoiseType.PINK, NoisePlayer.lastPlayed(context).value)
        val preferences = context.getSharedPreferences("playback", Context.MODE_PRIVATE)
        assertEquals("pink", preferences.getString("lastPlayed", null))
    }

    @Test
    fun thePlayButtonStopsTheNoiseOrPlaysTheLastOneAgain() {
        val service = playPinkNoise()

        NoisePlayer.togglePlayback(context)
        val stop = shadowOf(context).nextStartedService
        assertEquals(PlaybackService.stopIntent(context).toUri(0), stop.toUri(0))
        service.onStartCommand(stop, 0, 2)
        assertNull(NoisePlayer.nowPlaying.value)

        NoisePlayer.togglePlayback(context)
        val play = shadowOf(context).nextStartedService
        assertEquals(PlaybackService.playIntent(context, NoiseType.PINK).toUri(0), play.toUri(0))
    }

    @Test
    fun changingTheLanguageRelabelsTheNotification() {
        val service = playPinkNoise()

        RuntimeEnvironment.setQualifiers("de")
        service.onConfigurationChanged(context.resources.configuration)

        val notification = shadowOf(service).lastForegroundNotification
        assertEquals("Rosa Rauschen", notification.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("Stopp", notification.actions.single().title)
        val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel("playback")
        assertEquals("Wiedergabe", channel.name)
    }

    @Test
    @Config(sdk = [28], shadows = [RecordingMediaSession::class])
    fun savedLanguageRelabelsActivePlaybackWithoutAConfigurationChange() {
        shadowOf(context).grantPermissions("${context.packageName}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
        val service = playPinkNoise()

        LanguagePreferences.select(context, Language.DE)
        shadowOf(Looper.getMainLooper()).idle()

        val notification = shadowOf(service).lastForegroundNotification
        assertEquals("Rosa Rauschen", notification.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("Stopp", notification.actions.single().title)
        // Robolectric doesn't connect controllers to sessions; capture the published metadata.
        val session = ReflectionHelpers.getField<MediaSession>(service, "session")
        val metadata = Shadow.extract<RecordingMediaSession>(session).publishedMetadata
        assertEquals("Rosa Rauschen", metadata?.getString(MediaMetadata.METADATA_KEY_TITLE))
        assertEquals(NoiseType.PINK, NoisePlayer.nowPlaying.value)
        assertFalse(shadowOf(service).isForegroundStopped)
    }

    @Implements(MediaSession::class)
    class RecordingMediaSession : ShadowMediaSession() {
        var publishedMetadata: MediaMetadata? = null
            private set

        @Implementation
        protected fun setMetadata(metadata: MediaMetadata?) {
            publishedMetadata = metadata
        }
    }
}
