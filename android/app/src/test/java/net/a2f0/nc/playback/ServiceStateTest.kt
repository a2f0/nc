package net.a2f0.nc.playback

import net.a2f0.nc.NoiseType
import net.a2f0.nc.playback.ServiceEvent.FocusGained
import net.a2f0.nc.playback.ServiceEvent.FocusLostTransiently
import net.a2f0.nc.playback.ServiceEvent.Play
import net.a2f0.nc.playback.ServiceEvent.Stop
import net.a2f0.nc.playback.ServiceState.PausedForFocusLoss
import net.a2f0.nc.playback.ServiceState.Playing
import net.a2f0.nc.playback.ServiceState.Stopped
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServiceStateTest {
    private val pink = Playing(NoiseType.PINK)
    private val pausedPink = PausedForFocusLoss(NoiseType.PINK)

    @Test
    fun transitions() {
        val cases = listOf(
            Triple(Stopped, Play(NoiseType.PINK), pink),
            Triple(pink, Play(NoiseType.FAN), Playing(NoiseType.FAN)),
            Triple(pausedPink, Play(NoiseType.PINK), pink),
            Triple(pink, FocusLostTransiently, pausedPink),
            Triple(pausedPink, FocusGained, pink),
            Triple(pink, Stop, Stopped),
            Triple(pausedPink, Stop, Stopped),
            // Ignored: events that don't apply in the state.
            Triple(Stopped, Stop, Stopped),
            Triple(Stopped, FocusLostTransiently, Stopped),
            Triple(Stopped, FocusGained, Stopped),
            Triple(pausedPink, FocusLostTransiently, pausedPink),
            Triple(pink, FocusGained, pink),
        )
        for ((state, event, next) in cases) {
            assertEquals("$state + $event", next, state.on(event))
        }
    }

    @Test
    fun stoppingWhilePausedLeavesNothingToResume() {
        val state = pink.on(FocusLostTransiently).on(Stop).on(FocusGained)
        assertEquals(Stopped, state)
        assertNull(state.noise)
    }

    @Test
    fun theHeldNoiseIsPlayingOrPaused() {
        assertNull(Stopped.noise)
        assertEquals(NoiseType.PINK, pink.noise)
        assertEquals(NoiseType.PINK, pausedPink.noise)
    }
}
