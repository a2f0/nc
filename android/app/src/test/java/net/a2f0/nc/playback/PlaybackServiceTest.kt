package net.a2f0.nc.playback

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
}
