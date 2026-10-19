package net.a2f0.nc.ui

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import net.a2f0.nc.history.ListeningHistory
import net.a2f0.nc.history.ListeningSession

/** Freeze chart updates during Home/Recents transitions and refresh immediately on return.
 * Playback and durable checkpoints continue in the service while this UI is inactive.
 */
internal fun historyUpdates(history: ListeningHistory, lifecycle: Lifecycle): Flow<List<ListeningSession>> =
    channelFlow {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            launch { history.revision.collect { send(history.snapshot()) } }
            launch {
                while (true) {
                    delay(15_000)
                    send(history.snapshot())
                }
            }
        }
    }.distinctUntilChanged()
