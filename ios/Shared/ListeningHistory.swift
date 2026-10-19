import Foundation
import Observation

/// Version 1: UTC epoch milliseconds and immutable sound IDs, independent of display names.
struct ListeningSession: Codable, Identifiable, Sendable {
    let id: String
    let soundId: String
    let startedAt: Double
    var endedAt: Double?
    var updatedAt: Double

    var isValid: Bool {
        startedAt.isFinite && updatedAt.isFinite && updatedAt >= startedAt
            && (endedAt == nil || (endedAt!.isFinite && endedAt! >= startedAt && endedAt! <= updatedAt))
    }
}

struct HistoryDay: Identifiable {
    var id: Date { start }
    let start: Date
    let end: Date
    let minutes: [String: Double]
}

/// Calendar boundaries split overnight sessions correctly, including daylight-saving changes.
func historyDays(_ sessions: [ListeningSession], ending endDay: Date, calendar: Calendar = .current) -> [HistoryDay] {
    let end = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: endDay))!
    return (0..<7).map { index in
        let start = calendar.date(byAdding: .day, value: index - 7, to: end)!
        let next = calendar.date(byAdding: .day, value: 1, to: start)!
        var minutes: [String: Double] = [:]
        for session in sessions {
            let overlap = min(session.endedAt ?? session.updatedAt, next.timeIntervalSince1970 * 1000)
                - max(session.startedAt, start.timeIntervalSince1970 * 1000)
            minutes[session.soundId, default: 0] += max(0, overlap) / 60_000
        }
        return HistoryDay(start: start, end: next, minutes: minutes)
    }
}

@MainActor
@Observable
final class ListeningHistory {
    private var sessions: [String: ListeningSession] = [:]
    private var active: ListeningSession?
    private(set) var storageFailed = false
    @ObservationIgnored private let directory: URL
    @ObservationIgnored private let queue = DispatchQueue(label: "listening-history", qos: .utility)
    @ObservationIgnored private let clock: () -> Double

    init(directory: URL = URL.applicationSupportDirectory.appending(path: "listening-history-v1"),
         clock: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.directory = directory
        self.clock = clock
        queue.async { [weak self] in
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                var rows: [ListeningSession] = []
                var failed = false
                for file in files where file.pathExtension == "json" {
                    do {
                        let row = try JSONDecoder().decode(ListeningSession.self, from: Data(contentsOf: file))
                        if row.isValid { rows.append(row) } else { failed = true }
                    } catch { failed = true }
                }
                let loaded = rows
                let loadFailed = failed
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    for row in loaded where self.sessions[row.id] == nil { self.sessions[row.id] = row }
                    self.storageFailed = self.storageFailed || loadFailed
                }
            } catch {
                Task { @MainActor [weak self] in self?.storageFailed = true }
            }
        }
    }

    func transition(to soundId: String?) {
        guard active?.soundId != soundId else { return }
        let now = clock()
        if var row = active {
            row.updatedAt = max(row.updatedAt, now)
            row.endedAt = row.updatedAt
            save(row)
            active = nil
        }
        if let soundId {
            let row = ListeningSession(id: UUID().uuidString.lowercased(), soundId: soundId,
                                       startedAt: now, endedAt: nil, updatedAt: now)
            active = row
            save(row)
        }
    }

    func checkpoint() {
        guard var row = active else { return }
        row.updatedAt = max(row.updatedAt, clock())
        active = row
        save(row)
    }

    func snapshot() -> [ListeningSession] {
        let now = clock()
        return sessions.values.map { row in
            var copy = row
            if row.id == active?.id { copy.updatedAt = max(copy.updatedAt, now) }
            return copy
        }
    }

    /// A barrier for validation and callers that need to wait for durable writes.
    func flush() async {
        await withCheckedContinuation { continuation in
            queue.async { continuation.resume() }
        }
    }

    private func save(_ row: ListeningSession) {
        sessions[row.id] = row
        let file = directory.appending(path: row.id + ".json")
        queue.async { [weak self] in
            do {
                try JSONEncoder().encode(row).write(to: file, options: .atomic)
            } catch {
                Task { @MainActor [weak self] in self?.storageFailed = true }
            }
        }
    }
}
