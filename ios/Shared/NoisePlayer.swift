import AVFoundation
import MediaPlayer
import Observation
import WidgetKit
import UIKit
import os

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

    /// The noise currently playing, or nil when stopped.
    private(set) var nowPlaying: NoiseType? {
        didSet { history.transition(to: nowPlaying?.rawValue) }
    }

    /// The most recently played noise, which the play button and lock screen controls
    /// resume. Saved across launches.
    private(set) var lastPlayed: NoiseType

    /// The app's own volume, from 0 to 1, on top of the system volume. Saved across launches.
    private(set) var volume: Double

    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private let renderer = NoiseRenderer()
    @ObservationIgnored private var isConfigured = false
    @ObservationIgnored private var fadeOutTask: Task<Void, Never>?
    @ObservationIgnored private var interruptedNoise: NoiseType?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    private static let log = Logger(subsystem: "NoiseConnoisseur", category: "playback")
    private static let volumeKey = "volume"
    private static let lastPlayedKey = "lastPlayed"

    private init() {
        volume = UserDefaults.standard.object(forKey: Self.volumeKey) as? Double ?? 1
        lastPlayed = UserDefaults.standard.string(forKey: Self.lastPlayedKey).flatMap(NoiseType.init(rawValue:)) ?? .white
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
        nowPlaying = type
        lastPlayed = type
        UserDefaults.standard.set(type.rawValue, forKey: Self.lastPlayedKey)
        interruptedNoise = nil
        publishState()
    }

    /// Fades out, then stops the engine and releases the audio session.
    func stop(source: String = "ui", requested: Bool = true) {
        if requested { playbackLog.record(.stopRequested, soundId: nowPlaying?.rawValue, detail: source) }
        playbackLog.record(.stopped, soundId: nowPlaying?.rawValue, detail: source, updateActive: true)
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
            playbackLog.record(.engineFailed, detail: "setCategory: \(error)")
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
            MainActor.assumeIsolated { self?.handleInterruption(type, shouldResume: shouldResume, options: rawOptions) }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
            // Headphones unplugged or disconnected: stop rather than blast the speaker.
            let reason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            MainActor.assumeIsolated {
                self?.playbackLog.record(.routeChanged, soundId: self?.nowPlaying?.rawValue,
                                         detail: "reason=\(reason ?? 0)")
                if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                    self?.stop(source: "old_device_unavailable", requested: false)
                }
            }
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.restartAfterConfigurationChange() }
        })

        observers.append(center.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.playbackLog.record(.termination, soundId: self?.nowPlaying?.rawValue)
                self?.stop(source: "termination", requested: false)
                self?.playbackLog.flushOnTermination()
            }
        })
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.history.checkpoint() }
        })
        Self.registerRemoteCommands(for: self)
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
        playbackLog.record(.interruption, soundId: (nowPlaying ?? interruptedNoise)?.rawValue,
                           detail: "type=\(type.rawValue) (\(type == .began ? "began" : "ended")); options=\(options); shouldResume=\(shouldResume)")
        switch type {
        case .began:
            // The system has already stopped the engine.
            guard let noise = nowPlaying else { return }
            playbackLog.record(.stopped, soundId: noise.rawValue, detail: "interruption_began", updateActive: true)
            nowPlaying = nil
            interruptedNoise = noise
            publishState()
        case .ended:
            if shouldResume, let noise = interruptedNoise { play(noise, source: "interruption_ended") }
            interruptedNoise = nil
        @unknown default:
            break
        }
    }

    private func restartAfterConfigurationChange() {
        playbackLog.record(.configurationChanged, soundId: nowPlaying?.rawValue, detail: "isRunning=\(engine.isRunning)")
        guard nowPlaying != nil, !engine.isRunning else { return }
        do {
            try engine.start()
            playbackLog.record(.started, soundId: nowPlaying?.rawValue, detail: "configuration_change", updateActive: true, activeSound: nowPlaying?.rawValue)
        } catch {
            Self.log.error("Couldn't restart after configuration change: \(error)")
            playbackLog.record(.engineFailed, soundId: nowPlaying?.rawValue, detail: String(describing: error))
            stop(source: "configuration_restart_failed", requested: false)
        }
    }

    // MARK: - State

    private func publishState() {
        if nowPlaying != nil && historyTimer == nil {
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
