package net.a2f0.nc.playback

import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Looper
import net.a2f0.nc.NoiseType
import net.a2f0.nc.audio.PlaybackEngine
import net.a2f0.nc.history.ListeningHistory
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implements
import org.robolectric.annotation.Implementation
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowMediaSession
import org.robolectric.annotation.LooperMode
import java.time.Duration
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@LooperMode(LooperMode.Mode.PAUSED)
@Config(shadows = [PlaybackHistoryTest.RecordingSession::class])
class PlaybackHistoryTest {
    // Robolectric does not forward MediaSession.setPlaybackState to its controller.
    @Implements(MediaSession::class)
    class RecordingSession : ShadowMediaSession() {
        var playback: PlaybackState? = null
        @Implementation
        protected fun setPlaybackState(value: PlaybackState?) { playback = value }
    }

    class TestService : PlaybackService() {
        lateinit var started: (NoiseType) -> Unit
        lateinit var failed: () -> Unit
        var stops = 0
        val plays = mutableListOf<NoiseType>()
        internal override fun createEngine(onStarted: (NoiseType) -> Unit, onFailed: () -> Unit): PlaybackEngine {
            started = onStarted
            failed = onFailed
            return object : PlaybackEngine {
                override fun play(type: NoiseType) { plays.add(type) }
                override fun stop() { stops++ }
                override fun setVolume(volume: Float) {}
            }
        }
    }

    private lateinit var controller: ServiceController<TestService>
    private lateinit var service: TestService
    private lateinit var history: ListeningHistory
    private var initialIds = emptySet<String>()
    private val main = shadowOf(Looper.getMainLooper())

    @Before fun setUp() {
        val context = RuntimeEnvironment.getApplication()
        history = ListeningHistory.get(context)
        history.flush().get(5, TimeUnit.SECONDS)
        initialIds = history.snapshot().map { it.id }.toSet()
        controller = Robolectric.buildService(TestService::class.java, PlaybackService.playIntent(context, NoiseType.PINK))
            .create().startCommand(0, 1)
        service = controller.get()
        main.idle()
    }

    @After fun tearDown() { controller.destroy(); main.idle() }

    private fun rows() = history.snapshot().filter { it.id !in initialIds }
    private fun field(name: String): Any = PlaybackService::class.java.getDeclaredField(name).apply { isAccessible = true }.get(service)!!
    private fun focus(change: Int) {
        PlaybackService::class.java.getDeclaredMethod("onAudioFocusChange", Int::class.javaPrimitiveType)
            .apply { isAccessible = true }.invoke(service, change)
        main.idle()
    }
    private fun state() = Shadow.extract<RecordingSession>(field("session")).playback!!.state
    private fun started() { service.started(NoiseType.PINK); main.idle() }

    @Test fun failedStartCreatesNoSessionAndStopsTheService() {
        assertTrue(rows().isEmpty())
        service.failed()
        main.idle()
        assertTrue(rows().isEmpty())
        assertNull(NoisePlayer.nowPlaying.value)
        assertTrue(shadowOf(service).isStoppedBySelf)
        assertTrue(service.stops > 0)
    }

    @Test fun engineFailureClosesAnEstablishedSession() {
        started()
        assertNull(rows().single().endedAt)
        service.failed()
        main.idle()
        assertNotNull(rows().single().endedAt)
        assertNull(NoisePlayer.nowPlaying.value)
        assertTrue(shadowOf(service).isStoppedBySelf)
    }

    @Test fun focusLossClosesHistoryAndResumeWaitsForActualAudio() {
        started()
        focus(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
        val first = rows().single()
        assertNotNull(first.endedAt)
        assertEquals(PlaybackState.STATE_PAUSED, state())
        val pausedRevision = history.revision.value
        main.idleFor(Duration.ofSeconds(45))
        assertEquals(pausedRevision, history.revision.value)
        assertEquals(first, rows().single())
        // A callback already queued before focus was lost must not reopen the session.
        started()
        assertEquals(1, rows().size)
        focus(AudioManager.AUDIOFOCUS_GAIN)
        assertEquals(PlaybackState.STATE_PLAYING, state())
        assertEquals(listOf(NoiseType.PINK, NoiseType.PINK), service.plays)
        assertEquals(1, rows().size)
        started()
        assertEquals(2, rows().size)
        assertNull(rows().last().endedAt)
        val playingRevision = history.revision.value
        main.idleFor(Duration.ofSeconds(15))
        assertTrue(history.revision.value > playingRevision)
    }

    @Test fun permanentFocusLossAndRepeatedStopCloseOnlyOnce() {
        started()
        focus(AudioManager.AUDIOFOCUS_LOSS)
        assertNotNull(rows().single().endedAt)
        assertNull(NoisePlayer.nowPlaying.value)
        service.onStartCommand(PlaybackService.stopIntent(service), 0, 2)
        assertEquals(1, rows().size)
    }
}
