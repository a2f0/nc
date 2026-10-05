import AVFoundation
import MediaPlayer
import Observation
import WidgetKit
import os

/// Owns the audio engine and session. Playback continues in the background (the app
/// declares the `audio` background mode), responds to lock screen and headphone
/// controls, and publishes state for the widget.
@MainActor
@Observable
final class NoisePlayer {
    static let shared = NoisePlayer()

    /// The noise currently playing, or nil when stopped.
    private(set) var nowPlaying: NoiseType?

    /// The most recently played noise; used when resuming from lock screen controls.
    private(set) var lastPlayed: NoiseType = .white

    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private let renderer = NoiseRenderer()
    @ObservationIgnored private var isConfigured = false
    @ObservationIgnored private var fadeOutTask: Task<Void, Never>?
    @ObservationIgnored private var interruptedNoise: NoiseType?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    private static let log = Logger(subsystem: "NoiseConnoisseur", category: "playback")

    private init() {
        // A fresh process isn't playing anything, whatever the widget last showed.
        publishState()
    }

    func toggle(_ type: NoiseType) {
        if nowPlaying == type { stop() } else { play(type) }
    }

    func play(_ type: NoiseType) {
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
            return
        }
        nowPlaying = type
        lastPlayed = type
        interruptedNoise = nil
        publishState()
    }

    /// Fades out, then stops the engine and releases the audio session.
    func stop() {
        interruptedNoise = nil
        if nowPlaying != nil {
            nowPlaying = nil
            renderer.setFadingOut(true)
            fadeOutTask = Task {
                try? await Task.sleep(for: .seconds(NoiseRenderer.fadeDuration + 0.1))
                guard !Task.isCancelled else { return }
                self.engine.stop()
                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            }
        }
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
        }

        let hardwareRate = engine.outputNode.outputFormat(forBus: 0).sampleRate
        let format = AVAudioFormat(standardFormatWithSampleRate: hardwareRate > 0 ? hardwareRate : 48_000, channels: 2)!
        let source = renderer.makeSourceNode(format: format)
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: format)
        engine.prepare()

        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
            guard let rawType = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }
            let rawOptions = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: rawOptions).contains(.shouldResume)
            MainActor.assumeIsolated { self?.handleInterruption(type, shouldResume: shouldResume) }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
            // Headphones unplugged or disconnected: stop rather than blast the speaker.
            let reason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            guard reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue else { return }
            MainActor.assumeIsolated { self?.stop() }
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.restartAfterConfigurationChange() }
        })

        Self.registerRemoteCommands(for: self)
    }

    /// Nonisolated so the handlers aren't inferred to be main-actor isolated; the system
    /// doesn't guarantee which thread it calls them on.
    private nonisolated static func registerRemoteCommands(for player: NoisePlayer) {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { _ in
            Task { @MainActor in player.play(player.lastPlayed) }
            return .success
        }
        commands.pauseCommand.addTarget { _ in
            Task { @MainActor in player.stop() }
            return .success
        }
        commands.stopCommand.addTarget { _ in
            Task { @MainActor in player.stop() }
            return .success
        }
        commands.togglePlayPauseCommand.addTarget { _ in
            Task { @MainActor in player.toggle(player.nowPlaying ?? player.lastPlayed) }
            return .success
        }
    }

    // MARK: - System events

    private func handleInterruption(_ type: AVAudioSession.InterruptionType, shouldResume: Bool) {
        switch type {
        case .began:
            // The system has already stopped the engine.
            guard let noise = nowPlaying else { return }
            nowPlaying = nil
            interruptedNoise = noise
            publishState()
        case .ended:
            if shouldResume, let noise = interruptedNoise { play(noise) }
            interruptedNoise = nil
        @unknown default:
            break
        }
    }

    private func restartAfterConfigurationChange() {
        guard nowPlaying != nil, !engine.isRunning else { return }
        do {
            try engine.start()
        } catch {
            Self.log.error("Couldn't restart after configuration change: \(error)")
            nowPlaying = nil
            publishState()
        }
    }

    // MARK: - State

    private func publishState() {
        updateNowPlayingInfo()
        guard PlaybackStatus.nowPlaying != nowPlaying else { return }
        PlaybackStatus.nowPlaying = nowPlaying
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func updateNowPlayingInfo() {
        let center = MPNowPlayingInfoCenter.default()
        guard isConfigured else {
            center.nowPlayingInfo = nil
            return
        }
        center.nowPlayingInfo = [
            MPMediaItemPropertyTitle: (nowPlaying ?? lastPlayed).title,
            MPMediaItemPropertyArtist: "Noise Connoisseur",
            MPNowPlayingInfoPropertyIsLiveStream: true,
            MPNowPlayingInfoPropertyPlaybackRate: nowPlaying == nil ? 0.0 : 1.0,
        ]
    }
}
