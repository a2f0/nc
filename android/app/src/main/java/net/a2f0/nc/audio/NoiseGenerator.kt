package net.a2f0.nc.audio

import net.a2f0.nc.NoiseType
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Produces stereo noise, one frame at a time: each channel has its own random sequence, so
 * the stereo image is wide and decorrelated, while the fan's hum and the waves' swells are
 * shared. Owned by the audio thread; not thread-safe.
 */
internal class NoiseGenerator(private val sampleRate: Int, leftSeed: Int, rightSeed: Int) {
    /** The frame [next] produced. */
    var left = 0f
        private set
    var right = 0f
        private set

    private val leftChannel = Channel(leftSeed)
    private val rightChannel = Channel(rightSeed)

    /** For what both channels share: the fan's hum and each wave's shape. */
    private val shared = Random(leftSeed * 0x9E3779B9L.toInt() xor rightSeed)

    // The fan's rotation, in turns, and its hum: two band-pass filters on shared noise.
    private val fanRotationStep = (FAN_ROTATION_HZ / sampleRate).toFloat()
    private val fanAirCoefficient = lowPassCoefficient(FAN_AIR_CUTOFF_HZ, sampleRate)
    private var fanRotation = 0f
    private val fanHum = Resonator(FAN_ROTATION_HZ * FAN_BLADES, FAN_HUM_Q, sampleRate)
    private val fanHumOvertone = Resonator(2 * FAN_ROTATION_HZ * FAN_BLADES, FAN_HUM_Q, sampleRate)

    // Integer frame counts keep multi-second phase boundaries stable at every sample rate.
    private val waveDarkCoefficient = lowPassCoefficient(WAVE_DARK_HZ, sampleRate)
    private val waveBrightCoefficient = lowPassCoefficient(WAVE_BRIGHT_HZ, sampleRate)
    private val waveFoamDarkCoefficient = lowPassCoefficient(WAVE_FOAM_DARK_HZ, sampleRate)
    private val waveFoamBrightCoefficient = lowPassCoefficient(WAVE_FOAM_BRIGHT_HZ, sampleRate)
    private val waveWashCoefficient = lowPassCoefficient(WAVE_WASH_HZ, sampleRate)
    private val waveLowCoefficient = lowPassCoefficient(WAVE_LOW_HZ, sampleRate)
    private val wavePanCoefficient = (1 / (WAVE_PAN_SECONDS * sampleRate)).toFloat()
    private val waveTextureCoefficient = (1 / (0.045 * sampleRate)).toFloat()
    // Independent of the wave schedule and fan excitation; texture can't alter their timing.
    private val waveTextureRandom = Random(leftSeed xor rightSeed xor 0x85EBCA6BL.toInt())
    private var waveFrame = 0
    private var waveRiseFrames = 1
    private var waveFallFrames = 1
    private var wavePeak = 0f
    private var wavePan = 0f
    private var wavePanTarget = 0f
    private var waveTexture = 0.85f
    private var waveTextureTarget = 0.85f
    private var waveTextureFrames = 0

    init {
        startWave()
    }

    fun next(type: NoiseType) {
        when (type) {
            NoiseType.WHITE -> {
                left = leftChannel.white() * WHITE_GAIN
                right = rightChannel.white() * WHITE_GAIN
            }
            NoiseType.PINK -> {
                left = leftChannel.pink() * PINK_GAIN
                right = rightChannel.pink() * PINK_GAIN
            }
            NoiseType.BROWN -> {
                left = leftChannel.brown() * BROWN_GAIN
                right = rightChannel.brown() * BROWN_GAIN
            }
            NoiseType.WAVES -> waves()
            NoiseType.FAN -> fan()
        }
    }

    private fun fan() {
        fanRotation += fanRotationStep
        if (fanRotation >= 1f) fanRotation -= 1f
        var blade = fanRotation * FAN_BLADES
        blade -= floor(blade)
        val throb = 1f + FAN_BLADE_THROB * sine(blade) + FAN_ROTATION_WOBBLE * sine(fanRotation)

        val excitation = shared.white()
        val hum = FAN_HUM * fanHum.next(excitation) + FAN_HUM_OVERTONE * fanHumOvertone.next(excitation)
        left = (leftChannel.air(fanAirCoefficient) * throb + hum) * FAN_GAIN
        right = (rightChannel.air(fanAirCoefficient) * throb + hum) * FAN_GAIN
    }

    private fun waves() {
        val rising = waveFrame < waveRiseFrames
        val progress = if (rising) waveFrame.toFloat() / waveRiseFrames else (waveFrame - waveRiseFrames).toFloat() / waveFallFrames
        val swell = if (rising) smooth(progress) else 1f - smooth(progress / 0.78f)
        val body = wavePeak * swell * swell
        val breaking = if (rising) smooth((progress - 0.65f) / 0.35f) else 1f - smooth(progress / 0.55f)
        val foam = wavePeak * breaking * breaking
        // Water starts drawing back after the breaker, overlapping its soft tail.
        val wash = if (rising) 0f else wavePeak * smooth((progress - 0.12f) / 0.23f) * (1f - smooth((progress - 0.35f) / 0.65f))
        if (waveTextureFrames <= 0) {
            waveTextureTarget = 0.55f + 0.3f * (waveTextureRandom.white() + 1f)
            waveTextureFrames = max(1, ((0.07f + 0.085f * (waveTextureRandom.white() + 1f)).toDouble() * sampleRate).roundToInt())
        }
        waveTextureFrames--
        waveTexture += (waveTextureTarget - waveTexture) * waveTextureCoefficient
        wavePan += (wavePanTarget - wavePan) * wavePanCoefficient
        val brightness = waveDarkCoefficient + (waveBrightCoefficient - waveDarkCoefficient) * body
        val foamCoefficient = waveFoamDarkCoefficient + (waveFoamBrightCoefficient - waveFoamDarkCoefficient) * foam
        val bodyLevel = body * (0.9f + 0.1f * waveTexture)
        val foamLevel = foam * (0.75f + 0.25f * waveTexture)
        val washLevel = 0.55f * wash * waveTexture
        left = leftChannel.surf(
            brightness, bodyLevel, foamCoefficient, foamLevel,
            waveDarkCoefficient, waveWashCoefficient, waveLowCoefficient, washLevel,
        ) * (1f - wavePan) * WAVES_GAIN
        right = rightChannel.surf(
            brightness, bodyLevel, foamCoefficient, foamLevel,
            waveDarkCoefficient, waveWashCoefficient, waveLowCoefficient, washLevel,
        ) * (1f + wavePan) * WAVES_GAIN
        waveFrame++
        if (waveFrame >= waveRiseFrames + waveFallFrames) startWave()
    }

    /** New wave parameters; filter and texture states continue smoothly across events. */
    private fun startWave() {
        val riseSeconds = shared.between(WAVE_RISE_SECONDS).toDouble()
        val fallSeconds = shared.between(WAVE_FALL_SECONDS).toDouble()
        wavePeak = shared.between(WAVE_PEAK)
        wavePanTarget = WAVE_PAN * shared.white()
        waveFrame = 0
        waveRiseFrames = max(1, (riseSeconds * sampleRate).roundToInt())
        waveFallFrames = max(1, (fallSeconds * sampleRate).roundToInt())
    }

    private companion object {
        // Each noise lands at roughly the same RMS level (about -17 dBFS) with headroom for
        // peaks. Waves average about -23 dBFS, leaving headroom for their crests.
        const val WHITE_GAIN = 0.25f
        const val PINK_GAIN = 0.08f
        const val BROWN_GAIN = 2.46f
        const val FAN_GAIN = 0.093f
        const val WAVES_GAIN = 0.09f

        // Fan: a five-blade fan at 1,200 RPM. The air is pink noise with its highs rolled
        // off, throbbing slightly each time a blade passes, over a low hum at the blade rate.
        const val FAN_ROTATION_HZ = 20.0
        const val FAN_BLADES = 5f
        const val FAN_AIR_CUTOFF_HZ = 1_200.0
        const val FAN_BLADE_THROB = 0.12f
        const val FAN_ROTATION_WOBBLE = 0.04f
        const val FAN_HUM_Q = 16.0

        // The hum's band-pass filters let through only a sliver of the noise, hence the large gains.
        const val FAN_HUM = 40f
        const val FAN_HUM_OVERTONE = 20f

        // A swell rolls into a broad breaker, followed by a delayed, darker backwash.
        // The distant bed is independent of the moving layers; foam never becomes raw hiss.
        val WAVE_RISE_SECONDS = 3.5f..6f
        val WAVE_FALL_SECONDS = 4f..7f
        val WAVE_PEAK = 0.55f..1f
        const val WAVE_DARK_HZ = 350.0
        const val WAVE_BRIGHT_HZ = 2_200.0
        const val WAVE_FOAM_DARK_HZ = 580.0
        const val WAVE_FOAM_BRIGHT_HZ = 2_200.0
        const val WAVE_WASH_HZ = 700.0
        const val WAVE_LOW_HZ = 120.0
        const val WAVE_PAN = 0.18f
        const val WAVE_PAN_SECONDS = 1.5
    }
}

/** A xorshift32 PRNG (allocation-free, fast). */
private class Random(seed: Int) {
    private var state = if (seed == 0) 0x2545F491 else seed

    /** Uniform white noise in [-1, 1). */
    fun white(): Float {
        var x = state
        x = x xor (x shl 13)
        x = x xor (x ushr 17)
        x = x xor (x shl 5)
        state = x
        return x * (1f / 2147483648f)
    }

    /** Uniform in [range]. */
    fun between(range: ClosedFloatingPointRange<Float>): Float =
        range.start + (range.endInclusive - range.start) * (white() + 1f) * 0.5f
}

/** One channel's noise: its own random sequence, and the filters that shape it. */
private class Channel(seed: Int) {
    private val random = Random(seed)

    // Paul Kellet's pink noise filter state.
    private var b0 = 0f
    private var b1 = 0f
    private var b2 = 0f
    private var b3 = 0f
    private var b4 = 0f
    private var b5 = 0f
    private var b6 = 0f

    private var brownLevel = 0f

    // Two-pole low-pass filters (two one-poles in a row) for the fan and the waves.
    private var air1 = 0f
    private var air2 = 0f
    private var surf1 = 0f
    private var surf2 = 0f
    private var bed1 = 0f
    private var bed2 = 0f
    private var foam1 = 0f
    private var foam2 = 0f
    private var foamLow = 0f
    private var wash1 = 0f
    private var wash2 = 0f
    private var washLow = 0f

    fun white(): Float = random.white()

    /** Paul Kellet's refined -3 dB/octave filter applied to white noise. */
    fun pink(): Float {
        val w = white()
        b0 = 0.99886f * b0 + w * 0.0555179f
        b1 = 0.99332f * b1 + w * 0.0750759f
        b2 = 0.96900f * b2 + w * 0.1538520f
        b3 = 0.86650f * b3 + w * 0.3104856f
        b4 = 0.55000f * b4 + w * 0.5329522f
        b5 = -0.7616f * b5 - w * 0.0168980f
        val out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362f
        b6 = w * 0.115926f
        return out
    }

    /** White noise through a leaky integrator: -6 dB/octave above about 150 Hz. */
    fun brown(): Float {
        brownLevel = (brownLevel + 0.02f * white()) / 1.02f
        return brownLevel
    }

    /** The fan's air: pink noise through a two-pole low-pass filter. */
    fun air(coefficient: Float): Float {
        air1 += (pink() - air1) * coefficient
        air2 += (air1 - air2) * coefficient
        return air2
    }

    /** Separate distant surf, body, band-limited foam, and low-mid backwash. */
    fun surf(brightness: Float, body: Float, foamCoefficient: Float, foam: Float, bedCoefficient: Float, washCoefficient: Float, lowCoefficient: Float, wash: Float): Float {
        val pink = pink()
        bed1 += (pink - bed1) * bedCoefficient
        bed2 += (bed1 - bed2) * bedCoefficient
        surf1 += (pink - surf1) * brightness
        surf2 += (surf1 - surf2) * brightness
        foam1 += (white() - foam1) * foamCoefficient
        foam2 += (foam1 - foam2) * foamCoefficient
        foamLow += (foam2 - foamLow) * lowCoefficient
        wash1 += (pink - wash1) * washCoefficient
        wash2 += (wash1 - wash2) * washCoefficient
        washLow += (wash2 - washLow) * lowCoefficient
        return 0.2f * bed2 + surf2 * body + (foam2 - foamLow) * foam + (wash2 - washLow) * wash
    }
}

/** A band-pass filter (a Chamberlin state-variable filter) with unity gain at its center. */
private class Resonator(hz: Double, q: Double, sampleRate: Int) {
    private val frequency = (2 * sin(PI * hz / sampleRate)).toFloat()
    private val damping = (1 / q).toFloat()
    private var low = 0f
    private var band = 0f

    fun next(input: Float): Float {
        low += frequency * band
        val high = input - low - damping * band
        band += frequency * high
        return band * damping
    }
}

/** The coefficient of a one-pole low-pass filter with the given cutoff. */
private fun lowPassCoefficient(hz: Double, sampleRate: Int): Float = (1 - exp(-2 * PI * hz / sampleRate)).toFloat()

/** A parabolic approximation of sin(2π · phase), for a phase in [0, 1). */
private fun sine(phase: Float): Float {
    val x = 2 * phase - 1
    return 4 * x * (abs(x) - 1)
}

/** Smoothstep with zero slope at both ends: no abrupt break or backwash onset. */
private fun smooth(value: Float): Float {
    val x = value.coerceIn(0f, 1f)
    return x * x * (3f - 2f * x)
}
