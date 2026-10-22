import AVFoundation
import UIKit
import XCTest
@testable import NoiseConnoisseur

@MainActor
final class PlaybackTests: XCTestCase {
    func testPlaybackNotificationsAndRecoveryMarker() async throws {
        let player = NoisePlayer.shared
        let log = player.playbackLog
        player.stop(source: "test_reset", requested: false)
        player.setVolume(0)
        defer { player.stop(source: "test_cleanup", requested: false) }

        player.play(.pink)
        await log.flush()
        XCTAssertEqual(player.nowPlaying, .pink)
        XCTAssertEqual(try marker(), "pink")

        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        center.post(name: AVAudioSession.interruptionNotification, object: session, userInfo: [
            AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue,
        ])
        await log.flush()
        XCTAssertNil(player.nowPlaying)
        XCTAssertNil(try marker())

        center.post(name: AVAudioSession.interruptionNotification, object: session, userInfo: [
            AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue,
            AVAudioSessionInterruptionOptionKey: AVAudioSession.InterruptionOptions.shouldResume.rawValue,
        ])
        await log.flush()
        XCTAssertEqual(player.nowPlaying, .pink)
        XCTAssertEqual(try marker(), "pink")

        center.post(name: AVAudioSession.routeChangeNotification, object: session, userInfo: [
            AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue,
        ])
        await log.flush()
        XCTAssertNil(player.nowPlaying)
        XCTAssertNil(try marker())

        player.play(.fan, source: "media_play")
        player.stop(source: "media_pause")
        await log.flush()
        XCTAssertNil(try marker())
        let stoppedCount = try events().filter { $0["event"] as? String == "stopped" }.count
        player.stop(source: "media_stop")
        await log.flush()
        XCTAssertEqual(try events().filter { $0["event"] as? String == "stopped" }.count, stoppedCount)

        player.play(.brown, source: "widget_or_shortcut")
        center.post(name: UIApplication.willTerminateNotification, object: nil)
        // The callback must make both termination and marker closure durable before returning.
        XCTAssertNil(try marker())
        let rows = try events()
        for event in ["playRequested", "started", "stopped", "interruption", "routeChanged", "termination"] {
            XCTAssertTrue(rows.contains { $0["event"] as? String == event }, event)
        }
        for source in ["ui", "media_play", "media_pause", "widget_or_shortcut", "interruption_ended", "old_device_unavailable"] {
            XCTAssertTrue(rows.contains { $0["detail"] as? String == source }, source)
        }
    }

    private func contents() throws -> [String: Any] {
        let file = URL.applicationSupportDirectory.appending(path: "playback-log-v1.json")
        return try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
    }
    private func marker() throws -> String? { (try contents()["active"] as? [String: Any])?["soundId"] as? String }
    private func events() throws -> [[String: Any]] { try contents()["events"] as! [[String: Any]] }
}
