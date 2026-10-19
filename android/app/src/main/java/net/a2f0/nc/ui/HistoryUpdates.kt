package net.a2f0.nc.ui

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.launch
import net.a2f0.nc.history.ListeningHistory
import net.a2f0.nc.history.ListeningSession

internal data class HistoryUpdate(
    val sessions: List<ListeningSession>,
    // Also refresh the calendar date when playback is stopped or history is empty.
    val refreshedAt: Long,
)

/** Freeze chart updates during Home/Recents transitions and refresh immediately on return.
 * Playback and durable checkpoints continue in the service while this UI is inactive.
 */
internal fun historyUpdates(
    history: ListeningHistory,
    lifecycle: Lifecycle,
    clock: () -> Long = System::currentTimeMillis,
): Flow<HistoryUpdate> =
    channelFlow {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            launch { history.revision.collect { send(HistoryUpdate(history.snapshot(), clock())) } }
            launch {
                while (true) {
                    delay(15_000)
                    send(HistoryUpdate(history.snapshot(), clock()))
                }
            }
        }
    }
