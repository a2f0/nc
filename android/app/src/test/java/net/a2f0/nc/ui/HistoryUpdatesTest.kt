package net.a2f0.nc.ui

import android.os.Looper
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import java.nio.file.Files
import java.time.Duration
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import net.a2f0.nc.history.ListeningHistory
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@LooperMode(LooperMode.Mode.PAUSED)
class HistoryUpdatesTest {
    @Test fun pausesUpdatesWhileBackgroundedAndRefreshesOnReturn() {
        val directory = Files.createTempDirectory("history-updates").toFile()
        var now = 1_000L
        val history = ListeningHistory(directory) { now }
        history.flush().get(5, TimeUnit.SECONDS)
        val owner = object : LifecycleOwner {
            val registry = LifecycleRegistry(this)
            override val lifecycle: Lifecycle get() = registry
        }
        val main = shadowOf(Looper.getMainLooper())
        val scope = CoroutineScope(Dispatchers.Main.immediate)
        val values = mutableListOf<HistoryUpdate>()
        try {
            owner.registry.currentState = Lifecycle.State.CREATED
            scope.launch { historyUpdates(history, owner.lifecycle) { now }.collect { values.add(it) } }
            history.transition("white")
            main.idle()
            assertTrue(values.isEmpty())
            owner.registry.currentState = Lifecycle.State.RESUMED
            main.idle()
            assertEquals("white", values.last().sessions.single().soundId)
            now += 15_000
            main.idleFor(Duration.ofSeconds(15))
            assertEquals(now, values.last().sessions.single().updatedAt)
            // ON_PAUSE is enough: do not wait for ON_STOP after the transition.
            owner.registry.currentState = Lifecycle.State.STARTED
            main.idle()
            val pausedCount = values.size
            now += 45_000
            history.checkpoint()
            history.transition("pink")
            main.idleFor(Duration.ofSeconds(45))
            assertEquals(pausedCount, values.size)
            owner.registry.currentState = Lifecycle.State.RESUMED
            main.idle()
            assertEquals("pink", values.last().sessions.last().soundId)
            assertEquals(now, values.last().sessions.last().startedAt)
            history.transition(null)
            main.idle()
            val stopped = values.last()
            now += 15_000
            main.idleFor(Duration.ofSeconds(15))
            assertEquals(stopped.sessions, values.last().sessions)
            assertTrue(values.last().refreshedAt > stopped.refreshedAt)
            owner.registry.currentState = Lifecycle.State.DESTROYED
            main.idle()
            val destroyedCount = values.size
            history.transition(null)
            main.idleFor(Duration.ofSeconds(30))
            assertEquals(destroyedCount, values.size)
        } finally {
            scope.cancel()
            history.flush().get(5, TimeUnit.SECONDS)
            directory.deleteRecursively()
        }
    }
}
