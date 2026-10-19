package net.a2f0.nc.history

import android.content.Context
import android.util.AtomicFile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.Executors

/** Version 1: UTC epoch milliseconds; soundId is immutable and independent of the display name. */
data class ListeningSession(
    val id: String,
    val soundId: String,
    val startedAt: Long,
    val endedAt: Long?,
    val updatedAt: Long,
)

data class HistoryDay(val date: LocalDate, val minutes: Map<String, Double>)

fun historyDays(sessions: List<ListeningSession>, endDay: LocalDate, zone: ZoneId = ZoneId.systemDefault()): List<HistoryDay> =
    (6 downTo 0).map { offset ->
        val date = endDay.minusDays(offset.toLong())
        val start = date.atStartOfDay(zone).toInstant().toEpochMilli()
        val end = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        val minutes = mutableMapOf<String, Double>()
        for (row in sessions) {
            val overlap = (minOf(row.endedAt ?: row.updatedAt, end) - maxOf(row.startedAt, start)).coerceAtLeast(0)
            minutes[row.soundId] = (minutes[row.soundId] ?: 0.0) + overlap / 60_000.0
        }
        HistoryDay(date, minutes)
    }

/** All saved time; abandoned sessions end at their last durable checkpoint. */
fun historyTotals(sessions: List<ListeningSession>): Map<String, Double> {
    val minutes = mutableMapOf<String, Double>()
    for (row in sessions) {
        val duration = ((row.endedAt ?: row.updatedAt) - row.startedAt).coerceAtLeast(0) / 60_000.0
        minutes[row.soundId] = (minutes[row.soundId] ?: 0.0) + duration
    }
    return minutes
}

/** One atomic file per session; serialized disk I/O never blocks playback or the UI. */
class ListeningHistory(private val directory: File, private val clock: () -> Long = System::currentTimeMillis) {
    private val sessions = linkedMapOf<String, ListeningSession>()
    private var active: ListeningSession? = null
    private val writer = Executors.newSingleThreadExecutor()
    private val _revision = MutableStateFlow(0L)
    val revision = _revision.asStateFlow()
    private val _storageFailed = MutableStateFlow(false)
    val storageFailed = _storageFailed.asStateFlow()

    init {
        writer.execute {
            try {
                check(directory.isDirectory || directory.mkdirs())
                // AtomicFile may leave a backup after a crash; openRead recovers it.
                val names = directory.list()?.map { it.removeSuffix(".bak") }?.filter { it.endsWith(".json") }?.distinct()
                    ?: error("Cannot read listening history")
                for (name in names) {
                    try {
                        val json = JSONObject(AtomicFile(File(directory, name)).openRead().bufferedReader().use { it.readText() })
                        val row = ListeningSession(json.getString("id"), json.getString("soundId"), json.getLong("startedAt"),
                            if (json.isNull("endedAt")) null else json.getLong("endedAt"), json.getLong("updatedAt"))
                        require(row.updatedAt >= row.startedAt && (row.endedAt == null || row.endedAt in row.startedAt..row.updatedAt))
                        synchronized(this) { if (row.id !in sessions) sessions[row.id] = row }
                    } catch (_: Exception) { _storageFailed.value = true }
                }
                synchronized(this) { _revision.value++ }
            } catch (_: Exception) { _storageFailed.value = true }
        }
    }

    @Synchronized
    fun transition(soundId: String?) {
        if (active?.soundId == soundId) return
        val now = clock()
        active?.let { row ->
            val end = maxOf(row.updatedAt, now)
            save(row.copy(endedAt = end, updatedAt = end))
        }
        active = soundId?.let { ListeningSession(UUID.randomUUID().toString(), it, now, null, now) }
        active?.let(::save)
        _revision.value++
    }

    @Synchronized
    fun checkpoint() {
        active = active?.let { it.copy(updatedAt = maxOf(it.updatedAt, clock())) }
        active?.let(::save)
        _revision.value++
    }

    @Synchronized
    fun snapshot(): List<ListeningSession> {
        val now = clock()
        return sessions.values.map { if (it.id == active?.id) it.copy(updatedAt = maxOf(it.updatedAt, now)) else it }
    }

    /** A barrier for callers that need to wait for durable writes; never wait on the UI thread. */
    internal fun flush(): java.util.concurrent.Future<*> = writer.submit { }

    private fun save(row: ListeningSession) {
        sessions[row.id] = row
        writer.execute {
            val file = AtomicFile(File(directory, row.id + ".json"))
            var stream: java.io.FileOutputStream? = null
            try {
                val json = JSONObject().put("id", row.id).put("soundId", row.soundId).put("startedAt", row.startedAt)
                    .put("endedAt", row.endedAt ?: JSONObject.NULL).put("updatedAt", row.updatedAt)
                stream = file.startWrite()
                stream.write(json.toString().toByteArray(Charsets.UTF_8))
                file.finishWrite(stream)
            } catch (_: Exception) {
                file.failWrite(stream)
                _storageFailed.value = true
            }
        }
    }

    companion object {
        @Volatile private var instance: ListeningHistory? = null
        fun get(context: Context): ListeningHistory = instance ?: synchronized(this) {
            instance ?: ListeningHistory(File(context.applicationContext.filesDir, "listening-history-v1")).also { instance = it }
        }
    }
}
