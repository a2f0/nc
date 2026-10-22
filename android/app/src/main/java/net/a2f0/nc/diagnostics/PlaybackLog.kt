package net.a2f0.nc.diagnostics

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Process
import android.util.AtomicFile
import android.util.Log
import androidx.annotation.StringRes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import net.a2f0.nc.NoiseType
import net.a2f0.nc.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.concurrent.Executors

/** Stable codes are persisted; translated labels are resolved only for display/export. */
enum class PlaybackEvent(@StringRes val title: Int) {
    PLAY_REQUESTED(R.string.log_play_requested), STOP_REQUESTED(R.string.log_stop_requested),
    STARTED(R.string.log_started), STOPPED(R.string.log_stopped),
    FOCUS_CHANGED(R.string.log_focus_changed), FOCUS_DENIED(R.string.log_focus_denied),
    NOISY(R.string.log_noisy), TASK_REMOVED(R.string.log_task_removed),
    ENGINE_FAILED(R.string.log_engine_failed), SERVICE_DESTROYED(R.string.log_service_destroyed),
    PROCESS_EXIT(R.string.log_process_exit), UNCLEAN_EXIT(R.string.log_unclean_exit),
}

data class PlaybackLogEntry(val timestamp: Long, val event: PlaybackEvent, val soundId: String?, val detail: String)
data class OpenPlayback(val timestamp: Long, val pid: Int, val soundId: String)
data class PlaybackExit(val timestamp: Long, val pid: Int, val reason: Int, val importance: Int, val description: String)

/** All reads, recovery, and atomic writes share one queue; no disk I/O on the audio thread. */
class PlaybackLog(
    private val file: File,
    private val exits: () -> List<PlaybackExit> = { emptyList() },
    private val clock: () -> Long = System::currentTimeMillis,
    private val pid: Int = Process.myPid(),
) {
    private val writer = Executors.newSingleThreadExecutor()
    private val _entries = MutableStateFlow<List<PlaybackLogEntry>>(emptyList())
    val entries = _entries.asStateFlow()
    private val _storageFailed = MutableStateFlow(false)
    val storageFailed = _storageFailed.asStateFlow()
    private var active: OpenPlayback? = null

    init {
        writer.execute {
            try {
                if (file.exists() || File(file.path + ".bak").exists()) {
                    val json = JSONObject(AtomicFile(file).openRead().bufferedReader().use { it.readText() })
                    val rows = json.getJSONArray("events")
                    _entries.value = (maxOf(0, rows.length() - LIMIT) until rows.length()).map { i ->
                        val row = rows.getJSONObject(i)
                        PlaybackLogEntry(row.getLong("timestamp"), PlaybackEvent.valueOf(row.getString("event")),
                            if (row.isNull("soundId")) null else row.getString("soundId"), row.getString("detail").take(DETAIL_LIMIT))
                    }
                    json.optJSONObject("active")?.let {
                        active = OpenPlayback(it.getLong("timestamp"), it.getInt("pid"), it.getString("soundId"))
                    }
                }
            } catch (_: Exception) { _storageFailed.value = true }
            active?.let { previous ->
                val exit = try {
                    exits().filter { it.pid == previous.pid && it.timestamp >= previous.timestamp }.minByOrNull { it.timestamp }
                } catch (_: Exception) { null }
                append(PlaybackLogEntry(exit?.timestamp ?: clock(),
                    if (exit == null) PlaybackEvent.UNCLEAN_EXIT else PlaybackEvent.PROCESS_EXIT,
                    previous.soundId,
                    if (exit == null) "startedAt=${Instant.ofEpochMilli(previous.timestamp)}"
                    else "reason=${exit.reason} (${exitReason(exit.reason)}); importance=${exit.importance}; ${exit.description}"))
                active = null
                persist()
            }
        }
    }

    /** activeSound updates the recovery marker in the same atomic write as the event. */
    fun record(event: PlaybackEvent, sound: NoiseType? = null, detail: String = "", activeSound: String? = null, updateActive: Boolean = false) {
        val timestamp = clock()
        val row = PlaybackLogEntry(timestamp, event, sound?.id, detail.take(DETAIL_LIMIT))
        writer.execute {
            if (updateActive) active = activeSound?.let { OpenPlayback(timestamp, pid, it) }
            append(row)
            persist()
        }
    }

    private fun append(row: PlaybackLogEntry) {
        Log.i(TAG, "${Instant.ofEpochMilli(row.timestamp)} ${row.event.name} ${row.soundId ?: "-"} ${row.detail.take(DETAIL_LIMIT)}")
        _entries.value = (_entries.value + row.copy(detail = row.detail.take(DETAIL_LIMIT))).takeLast(LIMIT)
    }

    private fun persist() {
        val atomic = AtomicFile(file)
        var stream: java.io.FileOutputStream? = null
        try {
            check(file.parentFile!!.isDirectory || file.parentFile!!.mkdirs())
            val rows = JSONArray()
            for (row in _entries.value) rows.put(JSONObject().put("timestamp", row.timestamp).put("event", row.event.name)
                .put("soundId", row.soundId ?: JSONObject.NULL).put("detail", row.detail))
            val marker = active?.let { JSONObject().put("timestamp", it.timestamp).put("pid", it.pid).put("soundId", it.soundId) }
            val data = JSONObject().put("events", rows).put("active", marker ?: JSONObject.NULL).toString()
            stream = atomic.startWrite()
            stream.write(data.toByteArray(Charsets.UTF_8))
            atomic.finishWrite(stream)
        } catch (_: Exception) {
            atomic.failWrite(stream)
            _storageFailed.value = true
        }
    }

    /** Validation barrier; never called from playback. */
    fun flush() { writer.submit {}.get() }

    companion object {
        const val LIMIT = 300
        const val DETAIL_LIMIT = 512
        const val TAG = "NoisePlayback"
        @Volatile private var instance: PlaybackLog? = null

        fun get(context: Context): PlaybackLog = instance ?: synchronized(this) {
            instance ?: run {
                val app = context.applicationContext
                PlaybackLog(File(app.noBackupFilesDir, "playback-log-v1.json"), exits = {
                    if (Build.VERSION.SDK_INT >= 30) {
                        app.getSystemService(ActivityManager::class.java).getHistoricalProcessExitReasons(null, 0, 0)
                            .filter { it.processName == app.packageName }
                            .map { PlaybackExit(it.timestamp, it.pid, it.reason, it.importance, it.description.orEmpty()) }
                    } else emptyList()
                }).also { instance = it }
            }
        }

        // Numeric values also work on devices older than the newly introduced reason constants.
        internal fun exitReason(reason: Int): String = when (reason) {
            1 -> "EXIT_SELF"; 2 -> "SIGNALED"; 3 -> "LOW_MEMORY"; 4 -> "CRASH"; 5 -> "CRASH_NATIVE"
            6 -> "ANR"; 7 -> "INITIALIZATION_FAILURE"; 8 -> "PERMISSION_CHANGE"; 9 -> "EXCESSIVE_RESOURCE_USAGE"
            10 -> "USER_REQUESTED"; 11 -> "USER_STOPPED"; 12 -> "DEPENDENCY_DIED"; 13 -> "OTHER"
            14 -> "FREEZER"; 15 -> "PACKAGE_STATE_CHANGE"; 16 -> "PACKAGE_UPDATED"; else -> "UNKNOWN"
        }
    }
}
