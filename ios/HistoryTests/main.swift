import Foundation

@main
enum HistoryTests {
    @MainActor
    static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try await checkPersistence(in: directory)
        checkTotals()
        checkDaylightSaving()
        await checkInterruptions(in: directory.appending(path: "interruptions"))
        let checks = "persistence, duplicate transitions, crash recovery, clock rollback, midnight and DST"
        print("Listening history: \(checks) passed")
    }

    @MainActor
    private static func checkPersistence(in directory: URL) async throws {
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
        guard let first = history.snapshot().first(where: { $0.soundId == "white" }), let endedAt = first.endedAt else {
            preconditionFailure("The white noise session wasn't saved")
        }
        precondition(endedAt - first.startedAt == 120_000)
        precondition(history.snapshot().count == 2)
        now += 86_400_000
        let restored = ListeningHistory(directory: directory, clock: { now })
        await restored.flush()
        // The load is delivered back to the main actor after disk I/O.
        for _ in 0..<100 where restored.snapshot().count < 2 { await Task.yield() }
        precondition(restored.snapshot().first { $0.soundId == "fan" }?.updatedAt == 151_000)
        precondition(historyTotals(restored.snapshot())["fan"] == 0.5)
        precondition(historyTotals(history.snapshot())["fan"] == 1440.5)
        restored.transition(to: "pink")
        now -= 1000
        restored.transition(to: nil)
        restored.transition(to: nil)
        await restored.flush()
        precondition(restored.snapshot().count == 3)
        guard let pink = restored.snapshot().first(where: { $0.soundId == "pink" }) else {
            preconditionFailure("The pink noise session wasn't saved")
        }
        precondition(pink.startedAt == pink.endedAt)
        precondition(!restored.storageFailed)

        try Data("broken".utf8).write(to: directory.appending(path: "broken.json"))
        let invalid = ListeningSession(id: "invalid", soundId: "white", startedAt: 1000, endedAt: 900, updatedAt: 900)
        try JSONEncoder().encode(invalid).write(to: directory.appending(path: "invalid.json"))
        let recovered = ListeningHistory(directory: directory, clock: { now })
        await recovered.flush()
        for _ in 0..<100 where !recovered.storageFailed { await Task.yield() }
        precondition(recovered.storageFailed)
        precondition(recovered.snapshot().count == 3)
        precondition(recovered.snapshot().contains { $0.id == pink.id })
    }

    private static func checkTotals() {
        let totalRows = [
            ListeningSession(id: "old", soundId: "white", startedAt: 0, endedAt: 120_000, updatedAt: 180_000),
            ListeningSession(
                id: "recent",
                soundId: "white",
                startedAt: 1_800_000_000_000,
                endedAt: 1_800_000_180_000,
                updatedAt: 1_800_000_180_000,
            ),
            ListeningSession(id: "abandoned", soundId: "fan", startedAt: 1000, endedAt: nil, updatedAt: 31_000),
        ]
        precondition(historyTotals(totalRows) == ["white": 5, "fan": 0.5])
        precondition(historyTotals([]).isEmpty)
    }

    private static func checkDaylightSaving() {
        var calendar = Calendar(identifier: .gregorian)
        guard let newYork = TimeZone(identifier: "America/New_York") else {
            preconditionFailure("America/New_York is missing from the time zone database")
        }
        calendar.timeZone = newYork
        for (month, day, expected) in [(3, 8, 1380.0), (11, 1, 1500.0)] {
            guard let date = calendar.date(from: DateComponents(year: 2026, month: month, day: day)) else {
                preconditionFailure("2026-\(month)-\(day) isn't a date")
            }
            let next = calendar.date(addingDays: 1, to: date)
            let start = date.timeIntervalSince1970 * 1000 - 30 * 60_000
            let end = next.timeIntervalSince1970 * 1000 + 45 * 60_000
            let row = ListeningSession(id: "test", soundId: "fan", startedAt: start, endedAt: end, updatedAt: end)
            let days = historyDays([row], ending: next, calendar: calendar)
            precondition(days[4].minutes["fan"] == 30)
            precondition(days[5].minutes["fan"] == expected)
            precondition(days[6].minutes["fan"] == 45)
        }
    }

    @MainActor
    private static func checkInterruptions(in directory: URL) async {
        var now = 1000.0
        let interrupted = ListeningHistory(directory: directory, clock: { now })
        interrupted.transition(to: "waves")
        now += 60_000
        interrupted.transition(to: nil)
        now += 600_000
        interrupted.transition(to: "waves")
        now += 30_000
        interrupted.transition(to: nil)
        let rows = interrupted.snapshot()
        let durations = rows.compactMap { row in row.endedAt.map { $0 - row.startedAt } }
        precondition(durations.count == rows.count && durations.reduce(0, +) == 90_000)
        await interrupted.flush()
    }
}
