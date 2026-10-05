package net.a2f0.nc.audio

import net.a2f0.nc.NoiseType
import kotlin.math.max
import kotlin.math.min

/**
 * [volume] runs from 0 to 1. The gain is its square, which tracks perceived loudness
 * better than a straight line: halfway is about -12 dB.
 */
internal fun volumeGain(volume: Float): Float {
    val clamped = volume.coerceIn(0f, 1f)
    return clamped * clamped
}

/**
 * Fills interleaved stereo buffers with noise. The fade and volume gains ramp rather than
 * jump, so starting, stopping, and moving the volume slider don't click. Owned by the audio
 * thread; not thread-safe.
 */
internal class NoiseMixer(sampleRate: Int, leftSeed: Int, rightSeed: Int, volumeGain: Float) {
    // Independent generators per channel give a wide, decorrelated stereo image.
    private val left = NoiseGenerator(leftSeed)
    private val right = NoiseGenerator(rightSeed)
    private val fadeStep = 1f / (sampleRate * FADE_SECONDS)
    private val volumeStep = 1f / (sampleRate * VOLUME_RAMP_SECONDS)

    /** The fade gain: 0 when silent, 1 when fully faded in. */
    var fade = 0f
        private set

    /** The volume gain. It starts at the saved volume, so playback doesn't ramp to it. */
    var volume = volumeGain
        private set

    fun render(buffer: FloatArray, type: NoiseType, fadingOut: Boolean, volumeGain: Float) {
        val targetFade = if (fadingOut) 0f else 1f
        for (frame in 0 until buffer.size / 2) {
            fade = approach(fade, targetFade, fadeStep)
            volume = approach(volume, volumeGain, volumeStep)
            val gain = fade * volume
            buffer[frame * 2] = left.next(type) * gain
            buffer[frame * 2 + 1] = right.next(type) * gain
        }
    }

    private companion object {
        const val FADE_SECONDS = 0.4f

        /** How long a full-range volume change takes. */
        const val VOLUME_RAMP_SECONDS = 0.05f

        fun approach(value: Float, target: Float, step: Float): Float =
            if (value < target) min(value + step, target) else max(value - step, target)
    }
}
