package net.a2f0.nc.history

import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class ListeningHistoryTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun switchesPersistAndRestartDoesNotCountDowntime() {
        var now = 1_000L
        val directory = temporary.newFolder()
        val history = ListeningHistory(directory) { now }
        history.transition("white")
        now += 60_000
        history.transition("white")
        now += 60_000
        history.transition("fan")
        now += 30_000
        history.checkpoint()
        history.flush().get(5, TimeUnit.SECONDS)
        val rows = history.snapshot()
        assertEquals(2, rows.size)
        assertEquals(120_000L, rows.first().endedAt!! - rows.first().startedAt)
        assertNotEquals(rows[0].id, rows[1].id)
        now += 86_400_000
        val restored = ListeningHistory(directory) { now }
        restored.flush().get(5, TimeUnit.SECONDS)
        assertEquals(151_000L, restored.snapshot().first { it.soundId == "fan" }.updatedAt)
        assertEquals(0.5, historyTotals(restored.snapshot())["fan"]!!, 0.001)
        assertEquals(1440.5, historyTotals(history.snapshot())["fan"]!!, 0.001)
        restored.transition("pink")
        restored.transition(null)
        restored.transition(null)
        restored.flush().get(5, TimeUnit.SECONDS)
        assertEquals(3, restored.snapshot().size)
        assertFalse(restored.storageFailed.value)
    }

    @Test fun interruptionGapAndClockRollbackDoNotAddTime() {
        var now = 1_000L
        val history = ListeningHistory(temporary.newFolder()) { now }
        history.transition("waves")
        now += 60_000
        history.transition(null)
        now += 600_000
        history.transition("waves")
        now -= 10_000
        history.transition(null)
        val rows = history.snapshot()
        assertEquals(60_000L, rows.sumOf { it.endedAt!! - it.startedAt })
        history.flush().get(5, TimeUnit.SECONDS)
    }

    @Test fun daylightSavingAndMidnightAreCalendarBoundaries() {
        val zone = ZoneId.of("America/New_York")
        for ((day, minutes) in listOf(LocalDate.of(2026, 3, 8) to 1380.0, LocalDate.of(2026, 11, 1) to 1500.0)) {
            val start = day.atStartOfDay(zone).toInstant().toEpochMilli()
            val end = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
            val row = ListeningSession("test", "fan", start - 30 * 60_000, end + 45 * 60_000, end + 45 * 60_000)
            val days = historyDays(listOf(row), day.plusDays(1), zone)
            assertEquals(30.0, days[4].minutes["fan"]!!, 0.001)
            assertEquals(minutes, days[5].minutes["fan"]!!, 0.001)
            assertEquals(45.0, days[6].minutes["fan"]!!, 0.001)
        }
    }

    @Test fun allTimeTotalsIncludeOldSessionsAndStopAtCheckpoints() {
        val rows = listOf(
            ListeningSession("old", "white", 0, 120_000, 180_000),
            ListeningSession("recent", "white", 1_800_000_000_000, 1_800_000_180_000, 1_800_000_180_000),
            ListeningSession("abandoned", "fan", 1000, null, 31_000),
        )
        assertEquals(mapOf("white" to 5.0, "fan" to 0.5), historyTotals(rows))
        assertTrue(historyTotals(emptyList()).isEmpty())
    }

    @Test fun corruptFileDoesNotDiscardOtherSessions() {
        val directory = temporary.newFolder()
        val writer = ListeningHistory(directory) { 1000 }
        writer.transition("brown")
        writer.transition(null)
        writer.flush().get(5, TimeUnit.SECONDS)
        java.io.File(directory, "broken.json").writeText("broken")
        val history = ListeningHistory(directory) { 2000 }
        history.flush().get(5, TimeUnit.SECONDS)
        assertTrue(history.storageFailed.value)
        assertEquals(writer.snapshot(), history.snapshot())
    }
}
