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

    init() {
        // App Intents creates the intent with this, then sets its parameters.
    }

    init(noise: NoiseType) {
        self.noise = noise
    }

    // AppIntent declares perform() async; these have nothing to await.
    // swiftlint:disable:next async_without_await
    @MainActor func perform() async throws -> some IntentResult {
        NoisePlayer.shared.play(noise, source: "widget_or_shortcut")
        return .result()
    }
}

struct StopNoiseIntent: AudioPlaybackIntent {
    static let title = LocalizedStringResource("intent_stop_title")
    static let description = IntentDescription(LocalizedStringResource("intent_stop_description"))

    // swiftlint:disable:next async_without_await
    @MainActor func perform() async throws -> some IntentResult {
        NoisePlayer.shared.stop(source: "widget_or_shortcut")
        return .result()
    }
}
