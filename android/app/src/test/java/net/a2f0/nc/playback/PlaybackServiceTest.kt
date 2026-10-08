package net.a2f0.nc.playback

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
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
}
