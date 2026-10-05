/// Produces one channel of noise, one sample at a time. Owned by the audio render
/// thread; not thread-safe.
struct NoiseGenerator {
    private var rng: UInt32

    // Paul Kellet's pink noise filter state.
    private var b0: Float = 0
    private var b1: Float = 0
    private var b2: Float = 0
    private var b3: Float = 0
    private var b4: Float = 0
    private var b5: Float = 0
    private var b6: Float = 0

    // Both land at roughly the same RMS level (about -17 dBFS) with headroom for peaks.
    private static let whiteGain: Float = 0.25
    private static let pinkGain: Float = 0.08

    init(seed: UInt32) {
        rng = seed == 0 ? 0x2545_F491 : seed
    }

    mutating func next(_ type: NoiseType) -> Float {
        switch type {
        case .white: white() * Self.whiteGain
        case .pink: pink() * Self.pinkGain
        }
    }

    /// Uniform white noise in [-1, 1), from a xorshift32 PRNG (allocation- and lock-free).
    private mutating func white() -> Float {
        rng ^= rng << 13
        rng ^= rng >> 17
        rng ^= rng << 5
        return Float(Int32(bitPattern: rng)) * (1 / 2_147_483_648)
    }

    /// Paul Kellet's refined -3 dB/octave filter applied to white noise.
    private mutating func pink() -> Float {
        let w = white()
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.96900 * b2 + w * 0.1538520
        b3 = 0.86650 * b3 + w * 0.3104856
        b4 = 0.55000 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.0168980
        let out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
        b6 = w * 0.115926
        return out
    }
}
