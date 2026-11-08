package net.a2f0.nc.diagnostics

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Leaves a snapshot of this process with the system, which keeps the latest in its record of the
 * process's death ([PlaybackExit.state]). Its time shows whether the process was still running
 * shortly before it died; its heaps, the device's free memory, and the thermal status show
 * whether it was growing or the device was under pressure.
 */
internal object ProcessState {
    /** The most the system accepts; more throws. The summary is ASCII, so characters are bytes. */
    private const val MAX_BYTES = 128
    private const val BYTES_PER_MB = 1024 * 1024L

    fun record(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val activityManager = context.getSystemService(ActivityManager::class.java)
        val memory = ActivityManager.MemoryInfo().also(activityManager::getMemoryInfo)
        val runtime = Runtime.getRuntime()
        val javaHeap = runtime.totalMemory() - runtime.freeMemory()
        val thermal = context.getSystemService(PowerManager::class.java).currentThermalStatus
        val summary = "at=${Instant.now().truncatedTo(ChronoUnit.SECONDS)}" +
            " java=${javaHeap / BYTES_PER_MB}MB native=${Debug.getNativeHeapAllocatedSize() / BYTES_PER_MB}MB" +
            " avail=${memory.availMem / BYTES_PER_MB}MB low=${if (memory.lowMemory) 1 else 0} thermal=$thermal"
        activityManager.setProcessStateSummary(summary.take(MAX_BYTES).toByteArray(Charsets.UTF_8))
    }
}
