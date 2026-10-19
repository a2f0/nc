import Foundation

@main
struct HistoryTests {
    @MainActor
    static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var now = 1000.0
        let history = ListeningHistory(directory: directory, clock: { now })
        history.transition(to: "white")
        now += 60_000
        history.transition(to: "white")
        now += 60_000
        history.transition(to: "fan")
        now += 30_000
        history.checkpoint()
        await history.flush()
        let first = history.snapshot().first { $0.soundId == "white" }!
        precondition(first.endedAt! - first.startedAt == 120_000)
        precondition(history.snapshot().count == 2)
        now += 86_400_000
        let restored = ListeningHistory(directory: directory, clock: { now })
        await restored.flush()
        // The load is delivered back to the main actor after disk I/O.
        for _ in 0..<100 where restored.snapshot().count < 2 { await Task.yield() }
        precondition(restored.snapshot().first { $0.soundId == "fan" }!.updatedAt == 151_000)
        restored.transition(to: "pink")
        now -= 1000
        restored.transition(to: nil)
        restored.transition(to: nil)
        await restored.flush()
        precondition(restored.snapshot().count == 3)
        let pink = restored.snapshot().first { $0.soundId == "pink" }!
        precondition(pink.startedAt == pink.endedAt)
        precondition(!restored.storageFailed)

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        for (month, day, expected) in [(3, 8, 1380.0), (11, 1, 1500.0)] {
            let date = calendar.date(from: DateComponents(year: 2026, month: month, day: day))!
            let next = calendar.date(byAdding: .day, value: 1, to: date)!
            let start = date.timeIntervalSince1970 * 1000 - 30 * 60_000
            let end = next.timeIntervalSince1970 * 1000 + 45 * 60_000
            let row = ListeningSession(id: "test", soundId: "fan", startedAt: start, endedAt: end, updatedAt: end)
            let days = historyDays([row], ending: next, calendar: calendar)
            precondition(days[4].minutes["fan"] == 30)
            precondition(days[5].minutes["fan"] == expected)
            precondition(days[6].minutes["fan"] == 45)
        }
        print("Listening history: persistence, duplicate transitions, crash recovery, clock rollback, midnight and DST passed")
    }
}
