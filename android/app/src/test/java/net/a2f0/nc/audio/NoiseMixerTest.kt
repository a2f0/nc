package net.a2f0.nc.audio

import net.a2f0.nc.NoiseType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.log10

class NoiseMixerTest {
    private val sampleRate = 48_000

    private fun mixer(volume: Float = 1f) =
        NoiseMixer(sampleRate, leftSeed = 1, rightSeed = 2, volumeGain = volumeGain(volume))

    /** Renders [frames] frames and returns their RMS level in dBFS. */
    private fun NoiseMixer.render(
        frames: Int,
        volume: Float = 1f,
        fadingOut: Boolean = false,
        type: NoiseType = NoiseType.WHITE,
    ): Double {
        val buffer = FloatArray(frames * 2)
        render(buffer, type, fadingOut, volumeGain(volume))
        val power = buffer.sumOf { it.toDouble() * it } / buffer.size
        return 10 * log10(power)
    }

    private fun seconds(value: Double) = (value * sampleRate).toInt()

    @Test
    fun volumeGainIsTheSquareOfTheVolume() {
        assertEquals(1f, volumeGain(1f), 0f)
        assertEquals(0.25f, volumeGain(0.5f), 0f)
        assertEquals(0f, volumeGain(0f), 0f)
        assertEquals(1f, volumeGain(2f), 0f)
        assertEquals(0f, volumeGain(-1f), 0f)
    }

    @Test
    fun fullVolumePlaysAtAboutMinus17Dbfs() {
        val mixer = mixer()
        mixer.render(seconds(0.5))
        assertEquals(-17.0, mixer.render(seconds(0.1)), 0.6)
    }

    @Test
    fun halfVolumeIs12DbQuieter() {
        val mixer = mixer()
        mixer.render(seconds(0.5))
        val full = mixer.render(seconds(0.1))
        mixer.render(seconds(0.1), volume = 0.5f)
        assertEquals(full - 12.04, mixer.render(seconds(0.1), volume = 0.5f), 0.5)
    }

    @Test
    fun volumeRampsOverAbout50Milliseconds() {
        val mixer = mixer()
        mixer.render(seconds(0.5))
        mixer.render(seconds(0.02), volume = 0.5f)
        assertTrue("still ramping after 20 ms: ${mixer.volume}", mixer.volume > 0.25f && mixer.volume < 1f)
        mixer.render(seconds(0.03), volume = 0.5f)
        assertEquals(0.25f, mixer.volume, 0f)
    }

    @Test
    fun zeroVolumeIsSilent() {
        val mixer = mixer()
        mixer.render(seconds(0.5))
        mixer.render(seconds(0.1), volume = 0f)
        assertEquals(Double.NEGATIVE_INFINITY, mixer.render(seconds(0.1), volume = 0f), 0.0)
    }

    @Test
    fun startsAtTheSavedVolumeWithoutRamping() {
        val mixer = mixer(volume = 0.5f)
        assertEquals(0.25f, mixer.volume, 0f)
        mixer.render(seconds(0.5), volume = 0.5f)
        assertEquals(0.25f, mixer.volume, 0f)
        assertEquals(-17.0 - 12.04, mixer.render(seconds(0.1), volume = 0.5f), 0.6)
    }

    @Test
    fun fadesOutToSilenceIn400Milliseconds() {
        val mixer = mixer()
        mixer.render(seconds(0.5))
        mixer.render(seconds(0.41), fadingOut = true)
        assertEquals(0f, mixer.fade, 0f)
        assertEquals(Double.NEGATIVE_INFINITY, mixer.render(128, fadingOut = true), 0.0)
    }
}
