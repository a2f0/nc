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
        let stoppedCount = try events().count { $0.event == "stopped" }
        player.stop(source: "media_stop")
        await log.flush()
        XCTAssertEqual(try events().count { $0.event == "stopped" }, stoppedCount)

        player.play(.brown, source: "widget_or_shortcut")
        center.post(name: UIApplication.willTerminateNotification, object: nil)
        // The callback must make both termination and marker closure durable before returning.
        XCTAssertNil(try marker())
        try assertLoggedEveryEventAndSource()
    }

    func testInterruptionThatDoesNotResumeReleasesTheSession() async {
        let player = NoisePlayer.shared
        let log = player.playbackLog
        player.stop(source: "test_reset", requested: false)
        player.setVolume(0)
        let release = player.releaseSession
        let releases = Counter()
        defer {
            player.stop(source: "test_cleanup", requested: false)
            player.releaseSession = release
        }

        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        func interruption(_ type: AVAudioSession.InterruptionType) async {
            center.post(name: AVAudioSession.interruptionNotification, object: session, userInfo: [
                AVAudioSessionInterruptionTypeKey: type.rawValue,
            ])
            await log.flush()
        }

        // Playing cancels the reset's fade, so only this test's releases are counted.
        player.play(.pink)
        player.releaseSession = { releases.count += 1 }
        await interruption(.began)
        XCTAssertEqual(releases.count, 0)
        await interruption(.ended)
        XCTAssertNil(player.nowPlaying)
        XCTAssertEqual(releases.count, 1, "an interruption that ends without resuming releases the session")

        // Stopping while interrupted releases it too, and the interruption's end then changes nothing.
        player.releaseSession = release
        player.play(.pink)
        player.releaseSession = { releases.count += 1 }
        await interruption(.began)
        player.stop()
        XCTAssertEqual(releases.count, 2, "stopping while interrupted releases the session")
        await interruption(.ended)
        XCTAssertNil(player.nowPlaying)
        XCTAssertEqual(releases.count, 2)
    }

    func testPlayerStateTransitions() {
        let cases: [Transition] = [
            Transition(.stopped, .started(.pink), .playing(.pink)),
            Transition(.playing(.pink), .started(.fan), .playing(.fan)),
            Transition(.interrupted(.pink), .started(.fan), .playing(.fan)),
            Transition(.playing(.pink), .stop, .stopped, .fadeOut(.pink)),
            Transition(.interrupted(.pink), .stop, .stopped, .releaseSession),
            Transition(.playing(.pink), .interruptionBegan, .interrupted(.pink)),
            Transition(.interrupted(.pink), .interruptionEnded(shouldResume: true), .stopped, .resume(.pink)),
            Transition(.interrupted(.pink), .interruptionEnded(shouldResume: false), .stopped, .releaseSession),
            // Ignored: events that don't apply in the state.
            Transition(.stopped, .stop, .stopped),
            Transition(.stopped, .interruptionBegan, .stopped),
            Transition(.interrupted(.pink), .interruptionBegan, .interrupted(.pink)),
            Transition(.stopped, .interruptionEnded(shouldResume: true), .stopped),
            Transition(.stopped, .interruptionEnded(shouldResume: false), .stopped),
            // A noise played during the interruption isn't stopped by its end.
            Transition(.playing(.fan), .interruptionEnded(shouldResume: true), .playing(.fan)),
            Transition(.playing(.fan), .interruptionEnded(shouldResume: false), .playing(.fan)),
        ]
        for transition in cases {
            XCTAssertEqual(
                transition.state.handling(transition.event),
                transition.next,
                "\(transition.state) + \(transition.event)",
            )
        }
        XCTAssertNil(PlayerState.interrupted(.pink).nowPlaying)
        XCTAssertEqual(PlayerState.interrupted(.pink).noise, .pink)
        XCTAssertNil(PlayerState.stopped.noise)
    }

    private func assertLoggedEveryEventAndSource() throws {
        let rows = try events()
        for event in ["playRequested", "started", "stopped", "interruption", "routeChanged", "termination"] {
            XCTAssertTrue(rows.contains { $0.event == event }, event)
        }
        let sources = [
            "ui", "media_play", "media_pause", "widget_or_shortcut", "interruption_ended", "old_device_unavailable",
        ]
        for source in sources {
            XCTAssertTrue(rows.contains { $0.detail == source }, source)
        }
    }

    private func contents() throws -> LogFile {
        let file = URL.applicationSupportDirectory.appending(path: "playback-log-v1.json")
        return try JSONDecoder().decode(LogFile.self, from: Data(contentsOf: file))
    }

    private func marker() throws -> String? { try contents().active?.soundId }
    private func events() throws -> [LogEvent] { try contents().events }
}

@MainActor
private final class Counter {
    var count = 0
}

private struct Transition {
    let state: PlayerState
    let event: PlayerEvent
    let next: PlayerStep

    init(_ state: PlayerState, _ event: PlayerEvent, _ next: PlayerState, _ effect: PlayerEffect? = nil) {
        self.state = state
        self.event = event
        self.next = PlayerStep(next, effect)
    }
}

/// The parts of the log file these tests read, decoded independently of the app's types.
private struct LogFile: Decodable {
    struct Active: Decodable {
        let soundId: String
    }

    let events: [LogEvent]
    let active: Active?
}

private struct LogEvent: Decodable {
    let event: String
    let detail: String
}
