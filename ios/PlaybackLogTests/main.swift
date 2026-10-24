import Foundation

@main
enum PlaybackLogTests {
    @MainActor static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "log.json")
        let first = PlaybackLog(url: url)
        for index in 0..<350 {
            first.record(.playRequested, soundId: "pink", detail: "\(index):" + String(repeating: "x", count: 700))
        }
        await first.flush()
        let rows = try events(at: url)
        precondition(rows.count == 300)
        precondition(rows.first?.detail.hasPrefix("50:") == true)
        precondition(rows.allSatisfy { $0.detail.count == 512 })
        let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
        precondition(values.isExcludedFromBackup == true)
        first.record(.started, soundId: "pink", updateActive: true, activeSound: "pink")
        await first.flush()
        let recovered = PlaybackLog(url: url)
        await recovered.flush()
        let recoveredRows = try events(at: url)
        precondition(recoveredRows.last?.event == "uncleanExit")
        precondition(recoveredRows.last?.soundId == "pink")
        let again = PlaybackLog(url: url)
        await again.flush()
        let againRows = try events(at: url)
        precondition(againRows.count { $0.event == "uncleanExit" } == 1)
        again.record(.started, soundId: "fan", updateActive: true, activeSound: "fan")
        again.record(.stopped, soundId: "fan", updateActive: true)
        await again.flush()
        let stopped = PlaybackLog(url: url)
        await stopped.flush()
        let stoppedRows = try events(at: url)
        precondition(stoppedRows.last?.event == "stopped")
        print("Playback log: bounds, persistence, recovery, deduplication, normal stop, backup exclusion passed")
    }

    /// The parts of the log file these tests read, decoded independently of the app's types.
    private struct Event: Decodable {
        let event: String
        let soundId: String?
        let detail: String
    }

    private struct LogFile: Decodable {
        let events: [Event]
    }

    private static func events(at url: URL) throws -> [Event] {
        try JSONDecoder().decode(LogFile.self, from: Data(contentsOf: url)).events
    }
}
