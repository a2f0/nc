import Foundation

@main
struct PlaybackLogTests {
    @MainActor static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "log.json")
        let first = PlaybackLog(url: url)
        for index in 0..<350 { first.record(.playRequested, soundId: "pink", detail: "\(index):" + String(repeating: "x", count: 700)) }
        await first.flush()
        let data = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let rows = data["events"] as! [[String: Any]]
        precondition(rows.count == 300)
        precondition((rows.first!["detail"] as! String).hasPrefix("50:"))
        precondition(rows.allSatisfy { ($0["detail"] as! String).count == 512 })
        let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
        precondition(values.isExcludedFromBackup == true)
        first.record(.started, soundId: "pink", updateActive: true, activeSound: "pink")
        await first.flush()
        let recovered = PlaybackLog(url: url)
        await recovered.flush()
        let recoveredData = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let recoveredRows = recoveredData["events"] as! [[String: Any]]
        precondition(recoveredRows.last!["event"] as? String == "uncleanExit")
        precondition(recoveredRows.last!["soundId"] as? String == "pink")
        let again = PlaybackLog(url: url)
        await again.flush()
        let againData = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        precondition((againData["events"] as! [[String: Any]]).filter { $0["event"] as? String == "uncleanExit" }.count == 1)
        again.record(.started, soundId: "fan", updateActive: true, activeSound: "fan")
        again.record(.stopped, soundId: "fan", updateActive: true)
        await again.flush()
        let stopped = PlaybackLog(url: url)
        await stopped.flush()
        let stoppedData = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        precondition((stoppedData["events"] as! [[String: Any]]).last!["event"] as? String == "stopped")
        print("Playback log: bounds, persistence, recovery, deduplication, normal stop, backup exclusion passed")
    }
}
