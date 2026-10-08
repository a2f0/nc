import Foundation

/// Produces stereo noise, one frame at a time: each channel has its own random sequence, so
/// the stereo image is wide and decorrelated, while the fan's hum and the waves' swells are
/// shared. Owned by the audio render thread; not thread-safe.
struct NoiseGenerator {
    // Each noise lands at roughly the same RMS level (about -17 dBFS) with headroom for
    // peaks. Waves average about -23 dBFS, so their crests, at about -14, don't clip.
    private static let whiteGain: Float = 0.25
    private static let pinkGain: Float = 0.08
    private static let brownGain: Float = 2.46
    private static let fanGain: Float = 0.093
    private static let wavesGain: Float = 0.085

    // Fan: a five-blade fan at 1,200 RPM. The air is pink noise with its highs rolled off,
    // throbbing slightly each time a blade passes, over a low hum at the blade rate.
    private static let fanRotationHz: Double = 20
    private static let fanBlades: Float = 5
    private static let fanAirCutoffHz: Double = 1_200
    private static let fanBladeThrob: Float = 0.12
    private static let fanRotationWobble: Float = 0.04
    private static let fanHumQ: Double = 16
    // The hum's band-pass filters let through only a sliver of the noise, hence the large gains.
    private static let fanHum: Float = 40
    private static let fanHumOvertone: Float = 20

    // Waves: each swells for 3.5 to 6 seconds, breaks, and washes out over 4 to 7 seconds,
    // louder and brighter as it swells, over a quiet, dark bed of distant surf. Foam
    // hisses as each one washes out.
    private static let waveRiseSeconds: ClosedRange<Float> = 3.5...6
    private static let waveFallSeconds: ClosedRange<Float> = 4...7
    private static let wavePeak: ClosedRange<Float> = 0.55...1
    private static let waveBed: Float = 0.3
    private static let waveDarkHz: Double = 350
    private static let waveBrightHz: Double = 2_500
    private static let waveFoam: Float = 0.3
    private static let waveFoamCutoffHz: Double = 3_000
    /// How far a wave can sit to one side: 0 is centered, 1 is all the way.
    private static let wavePan: Float = 0.25
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

    // The current wave. `waveLevel` runs from 0 (calm) to the wave's peak.
    private let waveDarkCoefficient: Float
    private let waveBrightCoefficient: Float
    private let waveFoamCoefficient: Float
    private let wavePanCoefficient: Float
    private var waveLevel: Float = 0
    private var waveStart: Float = 0
    private var wavePeak: Float = 0
    private var waveRising = true
    private var waveProgress: Float = 0
    private var waveRiseStep: Float = 0
    private var waveFallStep: Float = 0
    private var waveDecay: Float = 1
    private var waveFoam: Float = 0
    private var waveFoamDecay: Float = 1
    private var wavePan: Float = 0
    private var wavePanTarget: Float = 0

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
        waveFoamCoefficient = lowPassCoefficient(hz: Self.waveFoamCutoffHz, sampleRate: sampleRate)
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
            (rightChannel.air(fanAirCoefficient) * throb + hum) * Self.fanGain
        )
    }

    private mutating func waves() -> (left: Float, right: Float) {
        if waveRising {
            waveProgress += waveRiseStep
            // Swells slowly at first, then faster, up to the break.
            let progress = min(waveProgress, 1)
            waveLevel = waveStart + (wavePeak - waveStart) * progress * progress
            if waveProgress >= 1 {
                waveRising = false
                waveProgress = 0
                waveFoam = wavePeak
            }
        } else {
            waveProgress += waveFallStep
            waveLevel *= waveDecay
            if waveProgress >= 1 { startWave() }
        }
        waveFoam *= waveFoamDecay
        wavePan += (wavePanTarget - wavePan) * wavePanCoefficient

        let brightness = waveDarkCoefficient + (waveBrightCoefficient - waveDarkCoefficient) * waveLevel
        let surf = Self.waveBed + waveLevel
        let foam = Self.waveFoam * waveFoam
        return (
            leftChannel.surf(brightness: brightness, level: surf, foamCoefficient: waveFoamCoefficient, foam: foam)
                * (1 - wavePan) * Self.wavesGain,
            rightChannel.surf(brightness: brightness, level: surf, foamCoefficient: waveFoamCoefficient, foam: foam)
                * (1 + wavePan) * Self.wavesGain
        )
    }

    /// Picks the next wave's size, timing, and place, and starts it swelling from the current level.
    private mutating func startWave() {
        let riseSeconds = Double(shared.between(Self.waveRiseSeconds))
        let fallSeconds = Double(shared.between(Self.waveFallSeconds))
        wavePeak = shared.between(Self.wavePeak)
        wavePanTarget = Self.wavePan * shared.white()
        waveStart = waveLevel
        waveRising = true
        waveProgress = 0
        waveRiseStep = Float(1 / (riseSeconds * sampleRate))
        waveFallStep = Float(1 / (fallSeconds * sampleRate))
        // Down to about 5% (three time constants) by the next wave; the foam lingers.
        waveDecay = Float(exp(-3 / (fallSeconds * sampleRate)))
        waveFoamDecay = Float(exp(-2 / (fallSeconds * sampleRate)))
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
    private var foamLow: Float = 0

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

    /// Surf: pink noise through a two-pole low-pass filter, plus foam: high-passed white noise.
    mutating func surf(brightness: Float, level: Float, foamCoefficient: Float, foam: Float) -> Float {
        surf1 += (pink() - surf1) * brightness
        surf2 += (surf1 - surf2) * brightness
        let w = white()
        foamLow += (w - foamLow) * foamCoefficient
        return surf2 * level + (w - foamLow) * foam
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
