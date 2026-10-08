package net.a2f0.nc.audio

import net.a2f0.nc.NoiseType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.max

class NoiseGeneratorTest {
    private val sampleRate = 48_000

    /** [count] frames of [type], as left and right channels. */
    private fun frames(type: NoiseType, count: Int, leftSeed: Int = 0x12345678, rightSeed: Int = 0x1abcdef0): Pair<FloatArray, FloatArray> {
        val generator = NoiseGenerator(sampleRate, leftSeed, rightSeed)
        val left = FloatArray(count)
        val right = FloatArray(count)
        for (i in 0 until count) {
            generator.next(type)
            left[i] = generator.left
            right[i] = generator.right
        }
        return left to right
    }

    private fun rmsDecibels(vararg channels: FloatArray): Double {
        val power = channels.sumOf { channel -> channel.sumOf { it.toDouble() * it } } / channels.sumOf { it.size }
        return 10 * log10(power)
    }

    @Test
    fun matchesTheIosGenerator() {
        // From ios/Shared/NoiseGenerator.swift at 48 kHz with seeds 1 and 2, as in
        // web/test/noiseGenerator.test.ts: the first frames, and frames a second in.
        val native = mapOf(
            NoiseType.WHITE to (floatArrayOf(3.1475094e-5f, 6.295019e-5f, 0.007873714f, 0.015629172f) to floatArrayOf(0.14455743f, -0.075551756f, -0.06802021f, -0.116097525f)),
            NoiseType.PINK to (floatArrayOf(1.6590504e-5f, 3.3181008e-5f, 0.0041600005f, 0.0082576675f) to floatArrayOf(0.06094571f, 0.21844976f, -0.015181789f, 0.1624472f)),
            NoiseType.BROWN to (floatArrayOf(6.072842e-6f, 1.2145684e-5f, 0.0015251174f, 0.0030274186f) to floatArrayOf(-0.076912805f, 0.19730704f, -0.08852861f, 0.17103827f)),
            NoiseType.FAN to (floatArrayOf(0.0002625548f, 0.0002629632f, -0.0022337092f, -0.0021319268f) to floatArrayOf(-0.02485629f, 0.3487985f, -0.0235182f, 0.34421605f)),
            NoiseType.WAVES to (floatArrayOf(1.0604759e-8f, 2.1209631e-8f, -6.4594926e-5f, 2.7426478e-5f) to floatArrayOf(0.016370308f, -0.039396435f, 0.015846081f, -0.03860277f)),
        )
        for ((type, expected) in native) {
            val (left, right) = frames(type, sampleRate + 2, leftSeed = 1, rightSeed = 2)
            val early = floatArrayOf(left[0], right[0], left[1], right[1])
            val late = floatArrayOf(left[sampleRate], right[sampleRate], left[sampleRate + 1], right[sampleRate + 1])
            for (i in 0 until 4) {
                assertEquals("$type, early sample $i", expected.first[i], early[i], 1e-7f)
                assertEquals("$type, late sample $i", expected.second[i], late[i], 1e-4f)
            }
        }
    }

    @Test
    fun noisesAreLevelMatchedAtAboutMinus17Dbfs() {
        for (type in listOf(NoiseType.WHITE, NoiseType.PINK, NoiseType.BROWN, NoiseType.FAN)) {
            val (left, right) = frames(type, 10 * sampleRate)
            assertEquals("$type", -17.0, rmsDecibels(left, right), 0.5)
        }
    }

    @Test
    fun wavesAverageAboutMinus23Dbfs() {
        val (left, right) = frames(NoiseType.WAVES, 120 * sampleRate)
        assertEquals(-23.0, rmsDecibels(left, right), 0.5)
    }

    @Test
    fun noisesStayWithinFullScale() {
        for (type in NoiseType.entries) {
            val (left, right) = frames(type, 120 * sampleRate)
            val peak = max(left.maxOf { abs(it) }, right.maxOf { abs(it) })
            assertTrue("$type peaks at $peak", peak < 0.9f)
        }
    }
}
