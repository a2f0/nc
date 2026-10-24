import Foundation

/// Produces stereo noise, one frame at a time: each channel has its own random sequence, so
/// the stereo image is wide and decorrelated, while the fan's hum and the waves' swells are
/// shared. Owned by the audio render thread; not thread-safe.
struct NoiseGenerator {
    // Each noise lands at roughly the same RMS level (about -17 dBFS) with headroom for
    // peaks. Waves average about -23 dBFS, leaving headroom for their crests.
    private static let whiteGain: Float = 0.25
    private static let pinkGain: Float = 0.08
    private static let brownGain: Float = 2.46
    private static let fanGain: Float = 0.093
    private static let wavesGain: Float = 0.09

    // Fan: a five-blade fan at 1,200 RPM. The air is pink noise with its highs rolled off,
    // throbbing slightly each time a blade passes, over a low hum at the blade rate.
    private static let fanRotationHz: Double = 20
    private static let fanBlades: Float = 5
    private static let fanAirCutoffHz: Double = 1200
    private static let fanBladeThrob: Float = 0.12
    private static let fanRotationWobble: Float = 0.04
    private static let fanHumQ: Double = 16
    // The hum's band-pass filters let through only a sliver of the noise, hence the large gains.
    private static let fanHum: Float = 40
    private static let fanHumOvertone: Float = 20

    // A swell rolls into a broad breaker, followed by a delayed, darker backwash.
    // The distant bed is independent of the moving layers; foam never becomes raw hiss.
    private static let waveRiseSeconds: ClosedRange<Float> = 3.5...6
    private static let waveFallSeconds: ClosedRange<Float> = 4...7
    private static let wavePeak: ClosedRange<Float> = 0.55...1
    private static let waveDarkHz: Double = 350
    private static let waveBrightHz: Double = 2200
    private static let waveFoamDarkHz: Double = 580
    private static let waveFoamBrightHz: Double = 2200
    private static let waveWashHz: Double = 700
    private static let waveLowHz: Double = 120
    private static let wavePan: Float = 0.18
    private static let wavePanSeconds: Double = 1.5

    private var leftChannel: Channel
    private var rightChannel: Channel
    /// For what both channels share: the fan's hum and each wave's shape.
    private var shared: Random
    private let sampleRate: Double

    // The fan's rotation, in turns, and its hum: two band-pass filters on shared noise.
    private let fanRotationStep: Float
    private let fanAirCoefficient: Float
    private var fanRotation: Float = 0
    private var fanHum: Resonator
    private var fanHumOvertone: Resonator

    // Integer frame counts keep multi-second phase boundaries stable at every sample rate.
    private let waveDarkCoefficient: Float
    private let waveBrightCoefficient: Float
    private let waveFoamDarkCoefficient: Float
    private let waveFoamBrightCoefficient: Float
    private let waveWashCoefficient: Float
    private let waveLowCoefficient: Float
    private let wavePanCoefficient: Float
    private let waveTextureCoefficient: Float
    private var waveTextureRandom: Random
    private var waveFrame = 0
    private var waveRiseFrames = 1
    private var waveFallFrames = 1
    private var wavePeak: Float = 0
    private var wavePan: Float = 0
    private var wavePanTarget: Float = 0
    private var waveTexture: Float = 0.85
    private var waveTextureTarget: Float = 0.85
    private var waveTextureFrames = 0

    init(sampleRate: Double, leftSeed: UInt32, rightSeed: UInt32) {
        self.sampleRate = sampleRate
        leftChannel = Channel(seed: leftSeed)
        rightChannel = Channel(seed: rightSeed)
        shared = Random(seed: (leftSeed &* 0x9E37_79B9) ^ rightSeed)

        fanRotationStep = Float(Self.fanRotationHz / sampleRate)
        fanAirCoefficient = lowPassCoefficient(hz: Self.fanAirCutoffHz, sampleRate: sampleRate)
        let bladeHz = Self.fanRotationHz * Double(Self.fanBlades)
        fanHum = Resonator(hz: bladeHz, q: Self.fanHumQ, sampleRate: sampleRate)
        fanHumOvertone = Resonator(hz: 2 * bladeHz, q: Self.fanHumQ, sampleRate: sampleRate)

        waveDarkCoefficient = lowPassCoefficient(hz: Self.waveDarkHz, sampleRate: sampleRate)
        waveBrightCoefficient = lowPassCoefficient(hz: Self.waveBrightHz, sampleRate: sampleRate)
        waveFoamDarkCoefficient = lowPassCoefficient(hz: Self.waveFoamDarkHz, sampleRate: sampleRate)
        waveFoamBrightCoefficient = lowPassCoefficient(hz: Self.waveFoamBrightHz, sampleRate: sampleRate)
        waveWashCoefficient = lowPassCoefficient(hz: Self.waveWashHz, sampleRate: sampleRate)
        waveLowCoefficient = lowPassCoefficient(hz: Self.waveLowHz, sampleRate: sampleRate)
        waveTextureCoefficient = Float(1 / (0.045 * sampleRate))
        // Independent of the wave schedule and fan excitation; texture can't alter their timing.
        waveTextureRandom = Random(seed: leftSeed ^ rightSeed ^ 0x85EB_CA6B)
        wavePanCoefficient = Float(1 / (Self.wavePanSeconds * sampleRate))
        startWave()
    }

    mutating func next(_ type: NoiseType) -> (left: Float, right: Float) {
        switch type {
        case .white: (leftChannel.white() * Self.whiteGain, rightChannel.white() * Self.whiteGain)
        case .pink: (leftChannel.pink() * Self.pinkGain, rightChannel.pink() * Self.pinkGain)
        case .brown: (leftChannel.brown() * Self.brownGain, rightChannel.brown() * Self.brownGain)
        case .waves: waves()
        case .fan: fan()
        }
    }

    private mutating func fan() -> (left: Float, right: Float) {
        fanRotation += fanRotationStep
        if fanRotation >= 1 { fanRotation -= 1 }
        var blade = fanRotation * Self.fanBlades
        blade -= blade.rounded(.down)
        let throb = 1 + Self.fanBladeThrob * sine(blade) + Self.fanRotationWobble * sine(fanRotation)

        let excitation = shared.white()
        let hum = Self.fanHum * fanHum.next(excitation) + Self.fanHumOvertone * fanHumOvertone.next(excitation)
        return (
            (leftChannel.air(fanAirCoefficient) * throb + hum) * Self.fanGain,
            (rightChannel.air(fanAirCoefficient) * throb + hum) * Self.fanGain,
        )
    }

    private mutating func waves() -> (left: Float, right: Float) {
        let rising = waveFrame < waveRiseFrames
        let progress = rising
            ? Float(waveFrame) / Float(waveRiseFrames)
            : Float(waveFrame - waveRiseFrames) / Float(waveFallFrames)
        let swell = rising ? smooth(progress) : 1 - smooth(progress / 0.78)
        let body = wavePeak * swell * swell
        let breaking = rising ? smooth((progress - 0.65) / 0.35) : 1 - smooth(progress / 0.55)
        let foam = wavePeak * breaking * breaking
        // Water starts drawing back after the breaker, overlapping its soft tail.
        let wash: Float = rising ? 0 : wavePeak * smooth((progress - 0.12) / 0.23) *
            (1 - smooth((progress - 0.35) / 0.65))
        if waveTextureFrames <= 0 {
            waveTextureTarget = 0.55 + 0.3 * (waveTextureRandom.white() + 1)
            waveTextureFrames = max(
                1,
                Int((Double(0.07 + 0.085 * (waveTextureRandom.white() + 1)) * sampleRate).rounded()),
            )
        }
        waveTextureFrames -= 1
        waveTexture += (waveTextureTarget - waveTexture) * waveTextureCoefficient
        wavePan += (wavePanTarget - wavePan) * wavePanCoefficient
        let brightness = waveDarkCoefficient + (waveBrightCoefficient - waveDarkCoefficient) * body
        let foamCoefficient = waveFoamDarkCoefficient + (waveFoamBrightCoefficient - waveFoamDarkCoefficient) * foam
        let bodyLevel = body * (0.9 + 0.1 * waveTexture)
        let foamLevel = foam * (0.75 + 0.25 * waveTexture)
        let washLevel = 0.55 * wash * waveTexture
        let mix = SurfMix(
            brightness: brightness,
            body: bodyLevel,
            foamCoefficient: foamCoefficient,
            foam: foamLevel,
            bedCoefficient: waveDarkCoefficient,
            washCoefficient: waveWashCoefficient,
            lowCoefficient: waveLowCoefficient,
            wash: washLevel,
        )
        let left = leftChannel.surf(mix) * (1 - wavePan) * Self.wavesGain
        let right = rightChannel.surf(mix) * (1 + wavePan) * Self.wavesGain
        waveFrame += 1
        if waveFrame >= waveRiseFrames + waveFallFrames { startWave() }
        return (left, right)
    }

    /// New wave parameters; filter and texture states continue smoothly across events.
    private mutating func startWave() {
        let riseSeconds = Double(shared.between(Self.waveRiseSeconds))
        let fallSeconds = Double(shared.between(Self.waveFallSeconds))
        wavePeak = shared.between(Self.wavePeak)
        wavePanTarget = Self.wavePan * shared.white()
        waveFrame = 0
        waveRiseFrames = max(1, Int((riseSeconds * sampleRate).rounded()))
        waveFallFrames = max(1, Int((fallSeconds * sampleRate).rounded()))
    }
}

/// A xorshift32 PRNG (allocation- and lock-free).
private struct Random {
    private var state: UInt32

    init(seed: UInt32) {
        state = seed == 0 ? 0x2545_F491 : seed
    }

    /// Uniform white noise in [-1, 1).
    mutating func white() -> Float {
        state ^= state << 13
        state ^= state >> 17
        state ^= state << 5
        return Float(Int32(bitPattern: state)) * (1 / 2_147_483_648)
    }

    /// Uniform in `range`.
    mutating func between(_ range: ClosedRange<Float>) -> Float {
        range.lowerBound + (range.upperBound - range.lowerBound) * (white() + 1) * 0.5
    }
}

/// One frame of the waves, the same in both channels: their filters' coefficients and levels.
private struct SurfMix {
    let brightness: Float
    let body: Float
    let foamCoefficient: Float
    let foam: Float
    let bedCoefficient: Float
    let washCoefficient: Float
    let lowCoefficient: Float
    let wash: Float
}

/// One channel's noise: its own random sequence, and the filters that shape it.
private struct Channel {
    private var random: Random

    // Paul Kellet's pink noise filter state.
    private var b0: Float = 0
    private var b1: Float = 0
    private var b2: Float = 0
    private var b3: Float = 0
    private var b4: Float = 0
    private var b5: Float = 0
    private var b6: Float = 0

    private var brownLevel: Float = 0

    // Two-pole low-pass filters (two one-poles in a row) for the fan and the waves.
    private var air1: Float = 0
    private var air2: Float = 0
    private var surf1: Float = 0
    private var surf2: Float = 0
    private var bed1: Float = 0
    private var bed2: Float = 0
    private var foam1: Float = 0
    private var foam2: Float = 0
    private var foamLow: Float = 0
    private var wash1: Float = 0
    private var wash2: Float = 0
    private var washLow: Float = 0

    init(seed: UInt32) {
        random = Random(seed: seed)
    }

    mutating func white() -> Float {
        random.white()
    }

    /// Paul Kellet's refined -3 dB/octave filter applied to white noise.
    mutating func pink() -> Float {
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

    /// White noise through a leaky integrator: -6 dB/octave above about 150 Hz.
    mutating func brown() -> Float {
        brownLevel = (brownLevel + 0.02 * white()) / 1.02
        return brownLevel
    }

    /// The fan's air: pink noise through a two-pole low-pass filter.
    mutating func air(_ coefficient: Float) -> Float {
        air1 += (pink() - air1) * coefficient
        air2 += (air1 - air2) * coefficient
        return air2
    }

    /// Separate distant surf, body, band-limited foam, and low-mid backwash.
    mutating func surf(_ mix: SurfMix) -> Float {
        let pink = pink()
        bed1 += (pink - bed1) * mix.bedCoefficient
        bed2 += (bed1 - bed2) * mix.bedCoefficient
        surf1 += (pink - surf1) * mix.brightness
        surf2 += (surf1 - surf2) * mix.brightness
        foam1 += (white() - foam1) * mix.foamCoefficient
        foam2 += (foam1 - foam2) * mix.foamCoefficient
        foamLow += (foam2 - foamLow) * mix.lowCoefficient
        wash1 += (pink - wash1) * mix.washCoefficient
        wash2 += (wash1 - wash2) * mix.washCoefficient
        washLow += (wash2 - washLow) * mix.lowCoefficient
        return 0.2 * bed2 + surf2 * mix.body + (foam2 - foamLow) * mix.foam + (wash2 - washLow) * mix.wash
    }
}

/// A band-pass filter (a Chamberlin state-variable filter) with unity gain at its center.
private struct Resonator {
    private let frequency: Float
    private let damping: Float
    private var low: Float = 0
    private var band: Float = 0

    init(hz: Double, q: Double, sampleRate: Double) {
        frequency = Float(2 * sin(.pi * hz / sampleRate))
        damping = Float(1 / q)
    }

    mutating func next(_ input: Float) -> Float {
        low += frequency * band
        let high = input - low - damping * band
        band += frequency * high
        return band * damping
    }
}

/// The coefficient of a one-pole low-pass filter with the given cutoff.
private func lowPassCoefficient(hz: Double, sampleRate: Double) -> Float {
    Float(1 - exp(-2 * .pi * hz / sampleRate))
}

/// A parabolic approximation of sin(2π · phase), for a phase in [0, 1).
private func sine(_ phase: Float) -> Float {
    let x = 2 * phase - 1
    return 4 * x * (abs(x) - 1)
}

/// Smoothstep with zero slope at both ends: no abrupt break or backwash onset.
private func smooth(_ value: Float) -> Float {
    let x = max(0, min(1, value))
    return x * x * (3 - 2 * x)
}
