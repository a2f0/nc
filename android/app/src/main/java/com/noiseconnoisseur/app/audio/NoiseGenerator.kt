package com.noiseconnoisseur.app.audio

import com.noiseconnoisseur.app.NoiseType

/**
 * Produces one channel of noise, one sample at a time. Owned by the audio thread;
 * not thread-safe.
 */
internal class NoiseGenerator(seed: Int) {
    private var rng = if (seed == 0) 0x2545F491 else seed

    // Paul Kellet's pink noise filter state.
    private var b0 = 0f
    private var b1 = 0f
    private var b2 = 0f
    private var b3 = 0f
    private var b4 = 0f
    private var b5 = 0f
    private var b6 = 0f

    fun next(type: NoiseType): Float = when (type) {
        NoiseType.WHITE -> white() * WHITE_GAIN
        NoiseType.PINK -> pink() * PINK_GAIN
    }

    /** Uniform white noise in [-1, 1), from a xorshift32 PRNG (allocation-free, fast). */
    private fun white(): Float {
        var x = rng
        x = x xor (x shl 13)
        x = x xor (x ushr 17)
        x = x xor (x shl 5)
        rng = x
        return x * (1f / 2147483648f)
    }

    /** Paul Kellet's refined -3 dB/octave filter applied to white noise. */
    private fun pink(): Float {
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

    private companion object {
        // Both land at roughly the same RMS level (about -17 dBFS) with headroom for peaks.
        const val WHITE_GAIN = 0.25f
        const val PINK_GAIN = 0.08f
    }
}
