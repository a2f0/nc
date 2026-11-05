import AVFoundation
import MediaPlayer
import Observation
import os
import UIKit
import WidgetKit

/// What the player is doing. Only `handling(_:)` changes it.
enum PlayerState: Equatable {
    case stopped
    case playing(NoiseType)
    /// The system stopped playback for an interruption (a call, an alarm); its end may resume this noise.
    case interrupted(NoiseType)

    /// The noise playing, or nil.
    var nowPlaying: NoiseType? {
        switch self {
        case let .playing(type): type
        case .stopped, .interrupted: nil
        }
    }

    /// The noise playing or interrupted, or nil.
    var noise: NoiseType? {
        switch self {
        case let .playing(type), let .interrupted(type): type
        case .stopped: nil
        }
    }

    /// The next state, and what the player must do about the change. Events that don't apply
    /// leave the state as it is and do nothing.
    func handling(_ event: PlayerEvent) -> PlayerStep {
        switch (self, event) {
        case let (_, .started(type)): PlayerStep(.playing(type))
        case let (.playing(type), .stop): PlayerStep(.stopped, .fadeOut(type))
        // The interruption already stopped the engine, so nothing fades; just let go of the session.
        case (.interrupted, .stop): PlayerStep(.stopped, .releaseSession)
        case (.stopped, .stop): PlayerStep(self)
        case let (.playing(type), .interruptionBegan): PlayerStep(.interrupted(type))
        case (.stopped, .interruptionBegan), (.interrupted, .interruptionBegan): PlayerStep(self)
        case let (.interrupted(type), .interruptionEnded(shouldResume: true)): PlayerStep(.stopped, .resume(type))
        case (.interrupted, .interruptionEnded(shouldResume: false)): PlayerStep(.stopped, .releaseSession)
        case (.stopped, .interruptionEnded), (.playing, .interruptionEnded): PlayerStep(self)
        }
    }
}

enum PlayerEvent: Equatable {
    /// The engine is running `type`.
    case started(NoiseType)
    case stop
    case interruptionBegan
    /// `shouldResume` is the system's hint that playback may resume.
    case interruptionEnded(shouldResume: Bool)
}

/// Side effects a transition asks of the player, which performs them; `handling(_:)` stays pure.
enum PlayerEffect: Equatable {
    /// Fade `type` out, then stop the engine and release the audio session.
    case fadeOut(NoiseType)
    /// Play `type` again.
    case resume(NoiseType)
    /// Stop the engine and deactivate the audio session, telling other apps they may resume.
    case releaseSession
}

/// One transition: the next state and the effect, if any, it asks for.
struct PlayerStep: Equatable {
    let state: PlayerState
    let effect: PlayerEffect?

    init(_ state: PlayerState, _ effect: PlayerEffect? = nil) {
        self.state = state
        self.effect = effect
    }
}

/// Owns the audio engine and session. Playback continues in the background (the app
/// declares the `audio` background mode), responds to lock screen and headphone
/// controls, and publishes state for the widget.
@MainActor
@Observable
final class NoisePlayer {
    static let shared = NoisePlayer()
    let history = ListeningHistory()
    let playbackLog = PlaybackLog()
    @ObservationIgnored private var historyTimer: Timer?

    private(set) var state = PlayerState.stopped {
        didSet { history.transition(to: nowPlaying?.rawValue) }
    }

    /// The noise currently playing, or nil when stopped.
    var nowPlaying: NoiseType? { state.nowPlaying }

    /// The most recently played noise, which the play button and lock screen controls
    /// resume. Saved across launches.
    private(set) var lastPlayed: NoiseType

    /// The app's own volume, from 0 to 1, on top of the system volume. Saved across launches.
    private(set) var volume: Double

    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private let renderer = NoiseRenderer()
    @ObservationIgnored private var isConfigured = false
    @ObservationIgnored private var fadeOutTask: Task<Void, Never>?
    @ObservationIgnored private var observers: [any NSObjectProtocol] = []

    /// Deactivates the audio session and tells other apps they may resume. Tests replace it.
    @ObservationIgnored var releaseSession: @MainActor () -> Void = {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private static let log = Logger(subsystem: "net.a2f0.nc", category: "NoisePlayback")
    private static let volumeKey = "volume"
    private static let lastPlayedKey = "lastPlayed"

    private init() {
        volume = UserDefaults.standard.object(forKey: Self.volumeKey) as? Double ?? 1
        lastPlayed = UserDefaults.standard.string(forKey: Self.lastPlayedKey)
            .flatMap(NoiseType.init(rawValue:)) ?? .white
        renderer.setVolume(volume)
        // A fresh process isn't playing anything, whatever the widget last showed.
        publishState()
    }

    func setVolume(_ value: Double) {
        volume = min(max(value, 0), 1)
        renderer.setVolume(volume)
        UserDefaults.standard.set(volume, forKey: Self.volumeKey)
    }

    func toggle(_ type: NoiseType, source: String = "ui") {
        if nowPlaying == type { stop(source: source) } else { play(type, source: source) }
    }

    /// Stops what's playing, or plays the last noise again.
    func togglePlayback(source: String = "ui") {
        toggle(nowPlaying ?? lastPlayed, source: source)
    }

    func play(_ type: NoiseType, source: String = "ui") {
        playbackLog.record(.playRequested, soundId: type.rawValue, detail: source)
        configureIfNeeded()
        fadeOutTask?.cancel()
        fadeOutTask = nil
        renderer.setNoise(type)
        renderer.setFadingOut(false)
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            if !engine.isRunning { try engine.start() }
        } catch {
            Self.log.error("Couldn't start playback: \(error)")
            playbackLog.record(.engineFailed, soundId: type.rawValue, detail: String(describing: error))
            stop(source: "engine_failed", requested: false)
            return
        }
        playbackLog.record(.started, soundId: type.rawValue, updateActive: true, activeSound: type.rawValue)
        perform(dispatch(.started(type)))
        lastPlayed = type
        UserDefaults.standard.set(type.rawValue, forKey: Self.lastPlayedKey)
        publishState()
    }

    /// Fades out, then stops the engine and releases the audio session.
    func stop(source: String = "ui", requested: Bool = true) {
        if requested { playbackLog.record(.stopRequested, soundId: nowPlaying?.rawValue, detail: source) }
        let effect = dispatch(.stop)
        if case let .fadeOut(stopping) = effect {
            playbackLog.record(.stopped, soundId: stopping.rawValue, detail: source, updateActive: true)
        }
        perform(effect)
        publishState()
    }

    // MARK: - Setup

    private func configureIfNeeded() {
        guard !isConfigured else { return }
        isConfigured = true

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .default)
        } catch {
            Self.log.error("Couldn't set audio session category: \(error)")
            playbackLog.record(.engineFailed, detail: "setCategory: \(error)")
        }

        let hardwareRate = engine.outputNode.outputFormat(forBus: 0).sampleRate
        guard let format = AVAudioFormat(
            standardFormatWithSampleRate: hardwareRate > 0 ? hardwareRate : 48_000,
            channels: 2,
        ) else { preconditionFailure("Stereo at a positive sample rate is always a valid format") }
        let source = renderer.makeSourceNode(format: format)
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: format)
        engine.prepare()

        observeSystemEvents(session: session)
        Self.registerRemoteCommands(for: self)
    }

    private func observeSystemEvents(session: AVAudioSession) {
        observe(AVAudioSession.interruptionNotification, object: session) { [weak self] note in
            guard let rawType = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }
            let rawOptions = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: rawOptions).contains(.shouldResume)
            MainActor.assumeIsolated { self?.handleInterruption(type, shouldResume: shouldResume, options: rawOptions) }
        }
        observe(AVAudioSession.routeChangeNotification, object: session) { [weak self] note in
            // Headphones unplugged or disconnected: stop rather than blast the speaker.
            let reason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            MainActor.assumeIsolated {
                self?.playbackLog.record(
                    .routeChanged,
                    soundId: self?.nowPlaying?.rawValue,
                    detail: "reason=\(reason ?? 0)",
                )
                if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                    self?.stop(source: "old_device_unavailable", requested: false)
                }
            }
        }
        observe(.AVAudioEngineConfigurationChange, object: engine) { [weak self] _ in
            MainActor.assumeIsolated { self?.restartAfterConfigurationChange() }
        }

        observe(UIApplication.willTerminateNotification) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.playbackLog.record(.termination, soundId: self?.nowPlaying?.rawValue)
                self?.stop(source: "termination", requested: false)
                self?.playbackLog.flushOnTermination()
            }
        }
        observe(UIApplication.didEnterBackgroundNotification) { [weak self] _ in
            MainActor.assumeIsolated { self?.history.checkpoint() }
        }
    }

    /// Calls `handler` on the main queue for each `name` notification for as long as the player lives.
    private func observe(
        _ name: Notification.Name,
        object: Any? = nil,
        using handler: @escaping @Sendable (Notification) -> Void,
    ) {
        observers.append(NotificationCenter.default.addObserver(
            forName: name,
            object: object,
            queue: .main,
            using: handler,
        ))
    }

    /// Nonisolated so the handlers aren't inferred to be main-actor isolated; the system
    /// doesn't guarantee which thread it calls them on.
    private nonisolated static func registerRemoteCommands(for player: NoisePlayer) {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { _ in
            Task { @MainActor in player.play(player.lastPlayed, source: "media_play") }
            return .success
        }
        commands.pauseCommand.addTarget { _ in
            Task { @MainActor in player.stop(source: "media_pause") }
            return .success
        }
        commands.stopCommand.addTarget { _ in
            Task { @MainActor in player.stop(source: "media_stop") }
            return .success
        }
        commands.togglePlayPauseCommand.addTarget { _ in
            Task { @MainActor in player.togglePlayback(source: "media_toggle") }
            return .success
        }
    }

    // MARK: - System events

    private func handleInterruption(_ type: AVAudioSession.InterruptionType, shouldResume: Bool, options: UInt) {
        let phase = type == .began ? "began" : "ended"
        playbackLog.record(
            .interruption,
            soundId: state.noise?.rawValue,
            detail: "type=\(type.rawValue) (\(phase)); options=\(options); shouldResume=\(shouldResume)",
        )
        switch type {
        case .began:
            // The system has already stopped the engine.
            guard let noise = nowPlaying else { return }
            playbackLog.record(.stopped, soundId: noise.rawValue, detail: "interruption_began", updateActive: true)
            perform(dispatch(.interruptionBegan))
            publishState()
        case .ended:
            perform(dispatch(.interruptionEnded(shouldResume: shouldResume)))
        @unknown default:
            break
        }
    }

    private func restartAfterConfigurationChange() {
        playbackLog.record(
            .configurationChanged,
            soundId: nowPlaying?.rawValue,
            detail: "isRunning=\(engine.isRunning)",
        )
        guard nowPlaying != nil, !engine.isRunning else { return }
        do {
            try engine.start()
            playbackLog.record(
                .started,
                soundId: nowPlaying?.rawValue,
                detail: "configuration_change",
                updateActive: true,
                activeSound: nowPlaying?.rawValue,
            )
        } catch {
            Self.log.error("Couldn't restart after configuration change: \(error)")
            playbackLog.record(.engineFailed, soundId: nowPlaying?.rawValue, detail: String(describing: error))
            stop(source: "configuration_restart_failed", requested: false)
        }
    }

    // MARK: - State

    private func publishState() {
        if nowPlaying != nil, historyTimer == nil {
            let timer = Timer(timeInterval: 15, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.history.checkpoint() }
            }
            historyTimer = timer
            RunLoop.main.add(timer, forMode: .common)
        } else if nowPlaying == nil {
            historyTimer?.invalidate()
            historyTimer = nil
        }
        updateNowPlayingInfo()
        guard PlaybackStatus.nowPlaying != nowPlaying else { return }
        PlaybackStatus.nowPlaying = nowPlaying
        WidgetCenter.shared.reloadAllTimelines()
    }

    func refreshLanguage() { updateNowPlayingInfo() }

    private func updateNowPlayingInfo() {
        let center = MPNowPlayingInfoCenter.default()
        guard isConfigured else {
            center.nowPlayingInfo = nil
            return
        }
        center.nowPlayingInfo = [
            MPMediaItemPropertyTitle: LanguageSettings.string((nowPlaying ?? lastPlayed).title),
            MPMediaItemPropertyArtist: LanguageSettings.string(.appName),
            MPNowPlayingInfoPropertyIsLiveStream: true,
            MPNowPlayingInfoPropertyPlaybackRate: nowPlaying == nil ? 0.0 : 1.0,
        ]
    }
}

// MARK: - Transitions

extension NoisePlayer {
    /// The only place `state` changes. Returns the effect the caller performs, after any logging.
    private func dispatch(_ event: PlayerEvent) -> PlayerEffect? {
        let step = state.handling(event)
        state = step.state
        return step.effect
    }

    private func perform(_ effect: PlayerEffect?) {
        switch effect {
        case .fadeOut:
            renderer.setFadingOut(true)
            fadeOutTask = Task {
                try? await Task.sleep(for: .seconds(NoiseRenderer.fadeDuration + 0.1))
                guard !Task.isCancelled else { return }
                self.engine.stop()
                self.releaseSession()
            }
        case let .resume(noise):
            play(noise, source: "interruption_ended")
        case .releaseSession:
            // The interruption stopped the engine; stopping it again is harmless and keeps
            // deactivation from failing because the session is still in use.
            engine.stop()
            releaseSession()
        case nil:
            break
        }
    }
}
