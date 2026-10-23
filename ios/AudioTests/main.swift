import AVFoundation

// Renders NoiseRenderer offline through AVAudioEngine and checks the output level: the fade,
// the volume curve, and the volume ramp. scripts/testing/testIosAudio.sh compiles this with
// the renderer's sources from ios/Shared for macOS and runs it. This folder isn't part of
// the Xcode project. Also checks seeded generator parity and wave backwash acoustics.

let sampleRate = 48_000.0
let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
var failures = 0

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
        try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4_800)
        let source = renderer.makeSourceNode(format: format)
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: format)
        try engine.start()
        buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: 4_800)!
    }

    /// Renders `seconds` of audio and returns the RMS level of all of it, in dBFS.
    func render(seconds: Double) throws -> Double {
        var remaining = AVAudioFrameCount(seconds * sampleRate)
        var power = 0.0
        var samples = 0
        while remaining > 0 {
            let frames = min(remaining, 4_800)
            guard try engine.renderOffline(frames, to: buffer) == .success else {
                throw CocoaError(.featureUnsupported)
            }
            for channel in 0..<Int(buffer.format.channelCount) {
                let data = buffer.floatChannelData![channel]
                for frame in 0..<Int(buffer.frameLength) {
                    power += Double(data[frame]) * Double(data[frame])
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
    check(try full.render(seconds: 0.1) == -.infinity, "zero volume is silent")

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
    check(try full.render(seconds: 0.1) == -.infinity, "fades out to silence in 400 ms")

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

// Shared seeded reference points also checked by Android and web.
let waveReferences: [Int: [(frame: Int, left: Float, right: Float)]] = [
    44100: [
        (132300, -0.014508246444165707, 0.07368697971105576),
        (264600, 0.029146987944841385, -0.22779574990272522),
        (352800, -0.002184402896091342, -0.022706639021635056),
        (441000, 0.009766509756445885, 0.011338476091623306),
        (882000, 0.01830667071044445, 0.0022752180229872465),
        (2646000, -0.031649909913539886, 0.026668190956115723),
    ],
    48000: [
        (144000, 0.07315686345100403, -0.044697001576423645),
        (288000, 0.3269042670726776, 0.15355661511421204),
        (384000, 0.020765312016010284, -0.16250570118427277),
        (480000, -0.02227717824280262, -0.020335981622338295),
        (960000, 0.002440560841932893, -0.0038006503600627184),
        (2880000, 0.02519976533949375, -0.014816612005233765),
    ],
    96000: [
        (288000, 0.10157521814107895, -0.028749089688062668),
        (576000, 0.1935761719942093, -0.15933851897716522),
        (768000, 0.0014603183371946216, 0.010455489158630371),
        (960000, 0.005584082566201687, -0.005136157851666212),
        (1920000, -0.007353504188358784, 0.026007970795035362),
        (5760000, -0.0043701473623514175, 0.016346722841262817),
    ],
]

// Seeded acoustic regression: the backwash must remain audible while losing the
// breaker's brightness. Windows assume seeds 1/2 (first crest near 5.54 seconds);
// reference samples below also guard the seeded schedule.
for rate in [44_100, 48_000, 96_000] {
    var generator = NoiseGenerator(sampleRate: Double(rate), leftSeed: 1, rightSeed: 2)
    var power = [Double](repeating: 0, count: 3)
    var differences = [Double](repeating: 0, count: 3)
    var counts = [Int](repeating: 0, count: 3)
    var previous: Float = 0
    var peak: Float = 0
    var jump: Float = 0
    var finite = true
    let references = waveReferences[rate]!
    var nextReference = 0
    var matchesReferences = true
    for frame in 0...(60 * rate) {
        let (left, right) = generator.next(.waves)
        if nextReference < references.count && frame == references[nextReference].frame {
            let reference = references[nextReference]
            matchesReferences = matchesReferences && abs(left - reference.left) < 0.0001 && abs(right - reference.right) < 0.0001
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
    check(brightness[2] < 0.6 * brightness[1] && brightness[2] < 0.003, "waves lose high-frequency hiss during backwash at \(rate) Hz")
}

exit(failures == 0 ? 0 : 1)
