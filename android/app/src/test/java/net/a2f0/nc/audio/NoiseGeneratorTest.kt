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
    private fun frames(
        type: NoiseType,
        count: Int,
        leftSeed: Int = 0x12345678,
        rightSeed: Int = 0x1abcdef0,
    ): Pair<FloatArray, FloatArray> {
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
            NoiseType.WHITE to Pair(
                floatArrayOf(3.1475094e-5f, 6.295019e-5f, 0.007873714f, 0.015629172f),
                floatArrayOf(0.14455743f, -0.075551756f, -0.06802021f, -0.116097525f),
            ),
            NoiseType.PINK to Pair(
                floatArrayOf(1.6590504e-5f, 3.3181008e-5f, 0.0041600005f, 0.0082576675f),
                floatArrayOf(0.06094571f, 0.21844976f, -0.015181789f, 0.1624472f),
            ),
            NoiseType.BROWN to Pair(
                floatArrayOf(6.072842e-6f, 1.2145684e-5f, 0.0015251174f, 0.0030274186f),
                floatArrayOf(-0.076912805f, 0.19730704f, -0.08852861f, 0.17103827f),
            ),
            NoiseType.FAN to Pair(
                floatArrayOf(0.0002625548f, 0.0002629632f, -0.0022337092f, -0.0021319268f),
                floatArrayOf(-0.02485629f, 0.3487985f, -0.0235182f, 0.34421605f),
            ),
            NoiseType.WAVES to Pair(
                floatArrayOf(
                    7.485718711564004e-09f,
                    1.497149426654687e-08f,
                    -4.559648732538335e-05f,
                    1.9359838915988803e-05f,
                ),
                floatArrayOf(
                    0.011851735413074493f,
                    -0.027014974504709244f,
                    0.011555495671927929f,
                    -0.02656673640012741f,
                ),
            ),
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

    @Test
    fun wavesMatchIosAcrossSampleRatesAndCyclesWithASofterRetreat() {
        for ((rate, points) in waveReferences) checkWaves(rate, points)
    }

    /** Renders the waves at [rate] up to the last of [points], checking each and the retreat's sound. */
    private fun checkWaves(rate: Int, points: List<Triple<Int, Float, Float>>) {
        val generator = NoiseGenerator(rate, 1, 2)
        var next = 0
        var previous = 0f
        var peak = 0f
        var jump = 0f
        var finite = true
        val power = DoubleArray(3)
        val differences = DoubleArray(3)
        val counts = IntArray(3)
        for (frame in 0..points.last().first) {
            generator.next(NoiseType.WAVES)
            val x = generator.left
            finite = finite && x.isFinite() && generator.right.isFinite()
            peak = max(peak, max(abs(x), abs(generator.right)))
            jump = max(jump, abs(x - previous))
            val window = waveWindow(frame.toDouble() / rate)
            if (window >= 0) {
                power[window] += x.toDouble() * x
                differences[window] += (x - previous).toDouble() * (x - previous)
                counts[window]++
            }
            previous = x
            if (next < points.size && frame == points[next].first) {
                assertEquals("left at $rate Hz / $frame", points[next].second, x, 0.0001f)
                assertEquals("right at $rate Hz / $frame", points[next].third, generator.right, 0.0001f)
                next++
            }
        }
        val rms = DoubleArray(3) { kotlin.math.sqrt(power[it] / counts[it]) }
        val brightness = DoubleArray(3) { differences[it] / power[it] * (rate / 48000.0) * (rate / 48000.0) }
        assertTrue("finite, unclipped and no jumps at $rate Hz", finite && peak < 0.9f && jump < 0.12f)
        assertEquals(points.size, next)
        assertTrue("audible but quieter retreat at $rate Hz", rms[2] > 1.5 * rms[0] && rms[2] < 0.65 * rms[1])
        assertTrue(
            "retreat loses brightness at $rate Hz",
            brightness[2] < 0.6 * brightness[1] && brightness[2] < 0.003,
        )
    }
}

/** The measured stretch of the first wave [second] is in: before it, breaking, or retreating; or -1. */
private fun waveWindow(second: Double): Int = when {
    second < 1 -> 0
    second >= 4.5 && second < 5.5 -> 1
    second >= 7 && second < 9 -> 2
    else -> -1
}

// Swift renders with seeds 1/2, including the backwash and later wave cycles.
private val waveReferences = mapOf(
    44100 to listOf(
        Triple(132300, -0.014508246444165707f, 0.07368697971105576f),
        Triple(264600, 0.029146987944841385f, -0.22779574990272522f),
        Triple(352800, -0.002184402896091342f, -0.022706639021635056f),
        Triple(441000, 0.009766509756445885f, 0.011338476091623306f),
        Triple(882000, 0.01830667071044445f, 0.0022752180229872465f),
        Triple(2646000, -0.031649909913539886f, 0.026668190956115723f),
    ),
    48000 to listOf(
        Triple(144000, 0.07315686345100403f, -0.044697001576423645f),
        Triple(288000, 0.3269042670726776f, 0.15355661511421204f),
        Triple(384000, 0.020765312016010284f, -0.16250570118427277f),
        Triple(480000, -0.02227717824280262f, -0.020335981622338295f),
        Triple(960000, 0.002440560841932893f, -0.0038006503600627184f),
        Triple(2880000, 0.02519976533949375f, -0.014816612005233765f),
    ),
    96000 to listOf(
        Triple(288000, 0.10157521814107895f, -0.028749089688062668f),
        Triple(576000, 0.1935761719942093f, -0.15933851897716522f),
        Triple(768000, 0.0014603183371946216f, 0.010455489158630371f),
        Triple(960000, 0.005584082566201687f, -0.005136157851666212f),
        Triple(1920000, -0.007353504188358784f, 0.026007970795035362f),
        Triple(5760000, -0.0043701473623514175f, 0.016346722841262817f),
    ),
)
