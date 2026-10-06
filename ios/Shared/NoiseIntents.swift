import AppIntents

// These are compiled into both the app and the widget extension. Because they're
// AudioPlaybackIntents, the system always performs them in the app's process
// (launching it in the background if needed), which is what allows a widget tap to
// start audio. Their titles are literal keys, which App Intents needs instead of the
// generated string symbols (see NoiseType.swift).

struct PlayNoiseIntent: AudioPlaybackIntent {
    static let title = LocalizedStringResource("intent_play_title")
    static let description = IntentDescription(LocalizedStringResource("intent_play_description"))

    @Parameter(title: LocalizedStringResource("intent_noise"))
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
    static let title = LocalizedStringResource("intent_stop_title")
    static let description = IntentDescription(LocalizedStringResource("intent_stop_description"))

    @MainActor
    func perform() async throws -> some IntentResult {
        NoisePlayer.shared.stop()
        return .result()
    }
}
