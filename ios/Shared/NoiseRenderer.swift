import AVFoundation
import Synchronization

/// Builds the realtime source node. Everything the main thread changes while audio is
/// running lives in atomics, so the render block never takes a lock or allocates.
final class NoiseRenderer: Sendable {
    static let fadeDuration: Double = 0.4
    /// How long a volume change takes to reach its new level, so dragging doesn't crackle.
    static let volumeRampDuration: Double = 0.05

    private let noise = Atomic<UInt8>(0)
    private let fadingOut = Atomic<Bool>(false)
    /// The volume's gain, as a `Float` bit pattern (there's no atomic `Float`).
    private let volumeGain = Atomic<UInt32>(Float(1).bitPattern)

    func setNoise(_ type: NoiseType) {
        noise.store(type == .white ? 0 : 1, ordering: .relaxed)
    }

    func setFadingOut(_ value: Bool) {
        fadingOut.store(value, ordering: .relaxed)
    }

    /// `volume` runs from 0 to 1. The gain is its square, which tracks perceived loudness
    /// better than a straight line: halfway is about -12 dB.
    func setVolume(_ volume: Double) {
        let clamped = Float(min(max(volume, 0), 1))
        volumeGain.store((clamped * clamped).bitPattern, ordering: .relaxed)
    }

    /// `format` must be a non-interleaved float format, as from
    /// `AVAudioFormat(standardFormatWithSampleRate:channels:)`.
    func makeSourceNode(format: AVAudioFormat) -> AVAudioSourceNode {
        let state = RenderState(
            sampleRate: format.sampleRate,
            volume: Float(bitPattern: volumeGain.load(ordering: .relaxed))
        )
        return AVAudioSourceNode(format: format) { [self] _, _, frameCount, audioBufferList in
            let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
            let type: NoiseType = noise.load(ordering: .relaxed) == 0 ? .white : .pink
            let target: Float = fadingOut.load(ordering: .relaxed) ? 0 : 1
            let targetVolume = Float(bitPattern: volumeGain.load(ordering: .relaxed))
            guard let left = buffers[0].mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            let right = buffers.count > 1 ? buffers[1].mData?.assumingMemoryBound(to: Float.self) : nil

            for frame in 0..<Int(frameCount) {
                state.gain = state.gain < target
                    ? min(state.gain + state.gainStep, target)
                    : max(state.gain - state.gainStep, target)
                state.volume = state.volume < targetVolume
                    ? min(state.volume + state.volumeStep, targetVolume)
                    : max(state.volume - state.volumeStep, targetVolume)
                let gain = state.gain * state.volume
                left[frame] = state.left.next(type) * gain
                right?[frame] = state.right.next(type) * gain
            }
            return noErr
        }
    }
}

/// Render-thread-only state. Captured exclusively by the render block.
private final class RenderState: @unchecked Sendable {
    // Independent generators per channel give a wide, decorrelated stereo image.
    var left = NoiseGenerator(seed: .random(in: 1...UInt32.max))
    var right = NoiseGenerator(seed: .random(in: 1...UInt32.max))
    var gain: Float = 0
    var volume: Float
    let gainStep: Float
    let volumeStep: Float

    init(sampleRate: Double, volume: Float) {
        self.volume = volume
        gainStep = Float(1 / (sampleRate * NoiseRenderer.fadeDuration))
        volumeStep = Float(1 / (sampleRate * NoiseRenderer.volumeRampDuration))
    }
}
