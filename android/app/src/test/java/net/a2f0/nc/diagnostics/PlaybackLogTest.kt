package net.a2f0.nc.diagnostics

import net.a2f0.nc.NoiseType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.nio.file.Files

@RunWith(RobolectricTestRunner::class)
class PlaybackLogTest {
    private fun file() = File(Files.createTempDirectory("playback-log").toFile(), "log.json")

    @Test fun boundedEventsAndDetailsSurviveRelaunch() {
        val file = file()
        val log = PlaybackLog(file)
        repeat(350) { log.record(PlaybackEvent.PLAY_REQUESTED, NoiseType.PINK, "$it:" + "x".repeat(700)) }
        log.flush()
        val reopened = PlaybackLog(file)
        reopened.flush()
        assertEquals(300, reopened.entries.value.size)
        assertTrue(reopened.entries.value.first().detail.startsWith("50:"))
        assertTrue(reopened.entries.value.all { it.detail.length == 512 && it.soundId == "pink" })
        assertFalse(reopened.storageFailed.value)
    }

    @Test fun matchesPackageUpdateToOpenPlaybackOnlyOnce() {
        val file = file()
        val first = PlaybackLog(file, clock = { 1000 }, pid = 42)
        first.record(PlaybackEvent.STARTED, NoiseType.BROWN, activeSound = "brown", updateActive = true)
        first.flush()
        val exits = {
            listOf(
                PlaybackExit(1500, 99, 3, 400, "different process"),
                PlaybackExit(900, 42, 3, 400, "old exit"),
                PlaybackExit(2000, 42, 16, 125, "killDueToPackageUpdate"),
            )
        }
        val recovered = PlaybackLog(file, exits, clock = { 3000 }, pid = 99)
        recovered.flush()
        val row = recovered.entries.value.last()
        assertEquals(PlaybackEvent.PROCESS_EXIT, row.event)
        assertEquals(2000L, row.timestamp)
        assertEquals("brown", row.soundId)
        assertTrue(row.detail.contains("PACKAGE_UPDATED"))
        assertTrue(row.detail.contains("importance=125"))
        val again = PlaybackLog(file, exits)
        again.flush()
        assertEquals(1, again.entries.value.count { it.event == PlaybackEvent.PROCESS_EXIT })
    }

    @Test fun missingExitInformationReportsUnknownAndNormalStopDoesNot() {
        val file = file()
        val first = PlaybackLog(file, clock = { 1000 })
        first.record(PlaybackEvent.STARTED, NoiseType.FAN, activeSound = "fan", updateActive = true)
        first.flush()
        val recovered = PlaybackLog(file, clock = { 2000 })
        recovered.flush()
        assertEquals(PlaybackEvent.UNCLEAN_EXIT, recovered.entries.value.last().event)
        assertEquals(2000L, recovered.entries.value.last().timestamp)
        recovered.record(PlaybackEvent.STARTED, NoiseType.FAN, activeSound = "fan", updateActive = true)
        recovered.record(PlaybackEvent.STOPPED, NoiseType.FAN, updateActive = true)
        recovered.flush()
        val stopped = PlaybackLog(file)
        stopped.flush()
        assertEquals(PlaybackEvent.STOPPED, stopped.entries.value.last().event)
    }

    @Test fun corruptOrUnwritableStorageDoesNotDiscardInMemoryEvents() {
        val file = file()
        file.writeText("broken")
        val log = PlaybackLog(file)
        log.record(PlaybackEvent.PLAY_REQUESTED, NoiseType.WHITE)
        log.flush()
        assertTrue(log.storageFailed.value)
        assertEquals(PlaybackEvent.PLAY_REQUESTED, log.entries.value.single().event)
        val impossible = PlaybackLog(File(file, "child"))
        impossible.record(PlaybackEvent.PLAY_REQUESTED, NoiseType.WHITE)
        impossible.flush()
        assertTrue(impossible.storageFailed.value)
        assertEquals(1, impossible.entries.value.size)
    }
}
