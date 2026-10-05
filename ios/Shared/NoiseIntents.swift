import AppIntents

// These are compiled into both the app and the widget extension. Because they're
// AudioPlaybackIntents, the system always performs them in the app's process
// (launching it in the background if needed), which is what allows a widget tap to
// start audio.

struct PlayNoiseIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Play Noise"
    static let description = IntentDescription("Starts playing white or pink noise.")

    @Parameter(title: "Noise")
    var noise: NoiseType

    init() {}

    init(noise: NoiseType) {
        self.noise = noise
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        NoisePlayer.shared.play(noise)
        return .result()
    }
}

struct StopNoiseIntent: AudioPlaybackIntent {
    static let title: LocalizedStringResource = "Stop Noise"
    static let description = IntentDescription("Stops playback.")

    @MainActor
    func perform() async throws -> some IntentResult {
        NoisePlayer.shared.stop()
        return .result()
    }
}
