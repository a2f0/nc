import AVFoundation

// Renders NoiseRenderer offline through AVAudioEngine and checks the output level: the fade,
// the volume curve, and the volume ramp. scripts/testing/testIosAudio.sh compiles this with
// the renderer's sources from ios/Shared for macOS and runs it. This folder isn't part of
// the Xcode project. Also checks seeded generator parity and wave backwash acoustics.

let sampleRate = 48_000.0
let format: AVAudioFormat = {
    guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2) else {
        preconditionFailure("Stereo at 48 kHz is always a valid format")
    }
    return format
}()

var failures = 0

@MainActor
func check(_ passed: Bool, _ description: String) {
    print("\(passed ? "ok" : "FAIL"): \(description)")
    if !passed { failures += 1 }
}

func near(_ value: Double, _ expected: Double, within tolerance: Double) -> Bool {
    abs(value - expected) <= tolerance
}

/// One renderer playing a noise (white by default) in an offline engine.
final class Harness {
    let renderer = NoiseRenderer()
    private let engine = AVAudioEngine()
    private let buffer: AVAudioPCMBuffer

    /// `volume` is set before the source node exists, like a volume restored at launch.
    init(volume: Double = 1, noise: NoiseType = .white) throws {
        renderer.setVolume(volume)
        renderer.setNoise(noise)
        try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4800)
        let source = renderer.makeSourceNode(format: format)
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: format)
        try engine.start()
        guard let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 4800) else {
            throw CocoaError(.featureUnsupported)
        }
        self.buffer = buffer
    }

    /// Renders `seconds` of audio and returns the RMS level of all of it, in dBFS.
    func render(seconds: Double) throws -> Double {
        var remaining = AVAudioFrameCount(seconds * sampleRate)
        var power = 0.0
        var samples = 0
        while remaining > 0 {
            let frames = min(remaining, 4800)
            guard try engine.renderOffline(frames, to: buffer) == .success,
                  let channels = unsafe buffer.floatChannelData
            else {
                throw CocoaError(.featureUnsupported)
            }
            for channel in 0..<Int(buffer.format.channelCount) {
                let data = unsafe channels[channel]
                for frame in 0..<Int(buffer.frameLength) {
                    let sample = Double(unsafe data[frame])
                    power += sample * sample
                }
                samples += Int(buffer.frameLength)
            }
            remaining -= frames
        }
        return 10 * log10(power / Double(samples))
    }
}

do {
    let full = try Harness()
    _ = try full.render(seconds: 0.5)
    let fullLevel = try full.render(seconds: 0.1)
    check(near(fullLevel, -17, within: 0.6), "full volume plays at about -17 dBFS (\(fullLevel))")

    full.renderer.setVolume(0.5)
    let ramping = try full.render(seconds: 0.02)
    check(ramping < fullLevel - 0.5 && ramping > fullLevel - 8, "the volume ramps rather than jumps (\(ramping))")
    _ = try full.render(seconds: 0.05)
    let half = try full.render(seconds: 0.1)
    check(near(half, fullLevel - 12.04, within: 0.5), "half volume is 12 dB quieter (\(half))")

    full.renderer.setVolume(0)
    _ = try full.render(seconds: 0.1)
    try check(full.render(seconds: 0.1) == -.infinity, "zero volume is silent")

    full.renderer.setVolume(2)
    _ = try full.render(seconds: 0.1)
    let clamped = try full.render(seconds: 0.1)
    check(near(clamped, fullLevel, within: 0.5), "volumes above 1 play at full volume (\(clamped))")

    let restored = try Harness(volume: 0.5)
    _ = try restored.render(seconds: 0.5)
    let restoredLevel = try restored.render(seconds: 0.1)
    check(near(restoredLevel, fullLevel - 12.04, within: 0.6), "starts at a saved volume (\(restoredLevel))")

    full.renderer.setVolume(1)
    full.renderer.setFadingOut(true)
    _ = try full.render(seconds: 0.41)
    try check(full.render(seconds: 0.1) == -.infinity, "fades out to silence in 400 ms")

    check(NoiseType.allCases.allSatisfy { NoiseType(index: $0.index) == $0 }, "the renderer can play every noise")
    for noise in NoiseType.allCases {
        let harness = try Harness(noise: noise)
        _ = try harness.render(seconds: 0.5)
        // Waves rise and fall, so they're measured over many of them.
        let (expected, seconds, tolerance) = noise == .waves ? (-23.0, 120.0, 2.0) : (-17.0, 2.0, 0.6)
        let level = try harness.render(seconds: seconds)
        check(near(level, expected, within: tolerance), "\(noise) plays at about \(Int(expected)) dBFS (\(level))")
    }
} catch {
    check(false, "rendering failed: \(error)")
}

struct WaveReference {
    let frame: Int
    let left: Float
    let right: Float
}

// Shared seeded reference points also checked by Android and web.
let waveReferences: [Int: [WaveReference]] = [
    44_100: [
        WaveReference(frame: 132_300, left: -0.014508246444165707, right: 0.07368697971105576),
        WaveReference(frame: 264_600, left: 0.029146987944841385, right: -0.22779574990272522),
        WaveReference(frame: 352_800, left: -0.002184402896091342, right: -0.022706639021635056),
        WaveReference(frame: 441_000, left: 0.009766509756445885, right: 0.011338476091623306),
        WaveReference(frame: 882_000, left: 0.01830667071044445, right: 0.0022752180229872465),
        WaveReference(frame: 2_646_000, left: -0.031649909913539886, right: 0.026668190956115723),
    ],
    48_000: [
        WaveReference(frame: 144_000, left: 0.07315686345100403, right: -0.044697001576423645),
        WaveReference(frame: 288_000, left: 0.3269042670726776, right: 0.15355661511421204),
        WaveReference(frame: 384_000, left: 0.020765312016010284, right: -0.16250570118427277),
        WaveReference(frame: 480_000, left: -0.02227717824280262, right: -0.020335981622338295),
        WaveReference(frame: 960_000, left: 0.002440560841932893, right: -0.0038006503600627184),
        WaveReference(frame: 2_880_000, left: 0.02519976533949375, right: -0.014816612005233765),
    ],
    96_000: [
        WaveReference(frame: 288_000, left: 0.10157521814107895, right: -0.028749089688062668),
        WaveReference(frame: 576_000, left: 0.1935761719942093, right: -0.15933851897716522),
        WaveReference(frame: 768_000, left: 0.0014603183371946216, right: 0.010455489158630371),
        WaveReference(frame: 960_000, left: 0.005584082566201687, right: -0.005136157851666212),
        WaveReference(frame: 1_920_000, left: -0.007353504188358784, right: 0.026007970795035362),
        WaveReference(frame: 5_760_000, left: -0.0043701473623514175, right: 0.016346722841262817),
    ],
]

// Seeded acoustic regression: the backwash must remain audible while losing the
// breaker's brightness. Windows assume seeds 1/2 (first crest near 5.54 seconds);
// reference samples below also guard the seeded schedule.
for (rate, references) in waveReferences.sorted(by: { $0.key < $1.key }) {
    var generator = NoiseGenerator(sampleRate: Double(rate), leftSeed: 1, rightSeed: 2)
    var power = [Double](repeating: 0, count: 3)
    var differences = [Double](repeating: 0, count: 3)
    var counts = [Int](repeating: 0, count: 3)
    var previous: Float = 0
    var peak: Float = 0
    var jump: Float = 0
    var finite = true
    var nextReference = 0
    var matchesReferences = true
    for frame in 0...(60 * rate) {
        let (left, right) = generator.next(.waves)
        if nextReference < references.count, frame == references[nextReference].frame {
            let reference = references[nextReference]
            let matches = abs(left - reference.left) < 0.0001 && abs(right - reference.right) < 0.0001
            matchesReferences = matchesReferences && matches
            nextReference += 1
        }
        finite = finite && left.isFinite && right.isFinite
        peak = max(peak, abs(left), abs(right))
        jump = max(jump, abs(left - previous))
        let second = Double(frame) / Double(rate)
        let window = second < 1 ? 0 : (second >= 4.5 && second < 5.5 ? 1 : (second >= 7 && second < 9 ? 2 : -1))
        if window >= 0 {
            power[window] += Double(left) * Double(left)
            differences[window] += Double(left - previous) * Double(left - previous)
            counts[window] += 1
        }
        previous = left
    }
    let rms = (0..<3).map { sqrt(power[$0] / Double(counts[$0])) }
    let brightness = (0..<3).map { differences[$0] / power[$0] * pow(Double(rate) / 48_000, 2) }
    check(matchesReferences && nextReference == references.count, "waves match shared reference samples at \(rate) Hz")
    check(finite && peak < 0.9 && jump < 0.12, "waves stay finite, unclipped and without jumps at \(rate) Hz")
    check(rms[2] > 1.5 * rms[0] && rms[2] < 0.65 * rms[1], "waves retain an audible, quieter backwash at \(rate) Hz")
    check(
        brightness[2] < 0.6 * brightness[1] && brightness[2] < 0.003,
        "waves lose high-frequency hiss during backwash at \(rate) Hz",
    )
}

exit(failures == 0 ? 0 : 1)
