import AVFoundation

// Renders NoiseRenderer offline through AVAudioEngine and checks the output level: the fade,
// the volume curve, and the volume ramp. scripts/checks/testIosAudio.sh compiles this with
// the renderer's sources from ios/Shared for macOS and runs it. This folder isn't part of
// the Xcode project.

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

exit(failures == 0 ? 0 : 1)
