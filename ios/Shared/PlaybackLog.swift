import Foundation
import Observation
import os

enum PlaybackEvent: String, Codable, Sendable {
    case playRequested, stopRequested, started, stopped, engineFailed, uncleanExit
    case interruption, routeChanged, configurationChanged, termination

    var title: LocalizedStringResource {
        switch self {
        case .playRequested: .logPlayRequested
        case .stopRequested: .logStopRequested
        case .started: .logStarted
        case .stopped: .logStopped
        case .engineFailed: .logEngineFailed
        case .uncleanExit: .logUncleanExit
        case .interruption: .logInterruption
        case .routeChanged: .logRouteChanged
        case .configurationChanged: .logConfigurationChanged
        case .termination: .logTermination
        }
    }
}

struct PlaybackLogEntry: Codable, Identifiable, Sendable {
    let id: UUID
    let timestamp: Date
    let event: PlaybackEvent
    let soundId: String?
    let detail: String
}

/// Accessed only on PlaybackLog's serial queue, including initial recovery.
private final class PlaybackLogFile: @unchecked Sendable {
    struct Active: Codable { let startedAt: Date; let soundId: String }
    struct Contents: Codable { var events: [PlaybackLogEntry] = []; var active: Active? }
    let url: URL
    var contents = Contents()
    var failed = false
    var revision = 0
    private static let logger = Logger(subsystem: "net.a2f0.nc", category: "NoisePlayback")

    init(url: URL) { self.url = url }

    func load() {
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true,
            )
            if FileManager.default.fileExists(atPath: url.path) {
                contents = try JSONDecoder().decode(Contents.self, from: Data(contentsOf: url))
                contents.events = Array(contents.events.suffix(300))
            }
            if let active = contents.active {
                // iOS does not provide Android's historical process-exit API.
                record(
                    .uncleanExit,
                    soundId: active.soundId,
                    detail: "startedAt=\(active.startedAt.ISO8601Format())",
                    timestamp: Date(),
                    updateActive: true,
                )
            }
        } catch { failed = true }
    }

    func record(
        _ event: PlaybackEvent,
        soundId: String?,
        detail: String,
        timestamp: Date,
        updateActive: Bool = false,
        activeSound: String? = nil,
    ) {
        let detail = String(detail.prefix(512))
        let row = PlaybackLogEntry(id: UUID(), timestamp: timestamp, event: event, soundId: soundId, detail: detail)
        let message = "\(timestamp.ISO8601Format()) \(event.rawValue) \(soundId ?? "-") \(detail)"
        Self.logger.info("\(message, privacy: .public)")
        contents.events.append(row)
        contents.events = Array(contents.events.suffix(300))
        if updateActive { contents.active = activeSound.map { Active(startedAt: timestamp, soundId: $0) } }
        do {
            try JSONEncoder().encode(contents).write(to: url, options: .atomic)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var file = url
            try file.setResourceValues(values)
        } catch { failed = true }
    }
}

/// Bounded local diagnostics, independent of history. Storage failures never stop audio.
@MainActor
@Observable
final class PlaybackLog {
    private(set) var entries: [PlaybackLogEntry] = []
    private(set) var storageFailed = false
    @ObservationIgnored private let queue = DispatchQueue(label: "net.a2f0.nc.playback-log")
    @ObservationIgnored private let file: PlaybackLogFile
    @ObservationIgnored private var revision = 0

    init(url: URL = URL.applicationSupportDirectory.appending(path: "playback-log-v1.json")) {
        file = PlaybackLogFile(url: url)
        enqueue { $0.load() }
    }

    func record(
        _ event: PlaybackEvent,
        soundId: String? = nil,
        detail: String = "",
        updateActive: Bool = false,
        activeSound: String? = nil,
    ) {
        let timestamp = Date()
        enqueue { $0.record(
            event,
            soundId: soundId,
            detail: detail,
            timestamp: timestamp,
            updateActive: updateActive,
            activeSound: activeSound,
        ) }
    }

    private func enqueue(_ action: @escaping @Sendable (PlaybackLogFile) -> Void) {
        let file = file
        queue.async { [weak self] in
            action(file)
            file.revision += 1
            let revision = file.revision
            let entries = file.contents.events
            let failed = file.failed
            Task { @MainActor [weak self] in
                guard let self, revision > self.revision else { return }
                self.revision = revision
                self.entries = entries
                storageFailed = failed
            }
        }
    }

    // Only the termination callback needs a synchronous durability barrier.
    func flushOnTermination() {
        queue.sync {
            // Returns once every write queued before it has finished.
        }
    }

    func flush() async {
        await withCheckedContinuation { continuation in
            queue.async { continuation.resume() }
        }
    }
}
