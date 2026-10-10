package net.a2f0.nc.audio

import net.a2f0.nc.NoiseType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max

@RunWith(RobolectricTestRunner::class)
class NoiseEngineTest {
    private val sampleRate = 48_000

    /**
     * Holds up to [bufferSizeInFrames] frames, as an AudioTrack does, playing the oldest as
     * new ones arrive, and discards what's still queued when released. Calls [stop] once
     * [stopAfterFrames] frames have been written.
     */
    private class FakeSink(
        override val bufferSizeInFrames: Int,
        private val stopAfterFrames: Int,
        private val stop: () -> Unit,
    ) : AudioSink {
        private val queue = ArrayDeque<Float>()
        private var writtenFrames = 0
        val released = CountDownLatch(1)

        var loudestPlayed = 0f
            private set

        /** The loudest sample still queued when released, so never played. */
        var loudestDiscarded = 0f
            private set

        override fun write(buffer: FloatArray, size: Int): Int {
            for (i in 0 until size) queue.addLast(buffer[i])
            while (queue.size > bufferSizeInFrames * 2) {
                loudestPlayed = max(loudestPlayed, abs(queue.removeFirst()))
            }
            writtenFrames += size / 2
            if (writtenFrames >= stopAfterFrames) stop()
            return size
        }

        override fun release() {
            loudestDiscarded = queue.maxOfOrNull { abs(it) } ?: 0f
            released.countDown()
        }
    }

    @Test
    fun stoppingPlaysTheWholeFadeOutBeforeReleasing() {
        lateinit var engine: NoiseEngine
        // A deep buffer: 200 ms, many writes' worth.
        val sink = FakeSink(bufferSizeInFrames = sampleRate / 5, stopAfterFrames = sampleRate) {
            engine.stop()
        }
        engine = NoiseEngine { sink }

        engine.play(NoiseType.WHITE)

        assertTrue("the engine never released its sink", sink.released.await(10, TimeUnit.SECONDS))
        assertTrue("no noise was played: ${sink.loudestPlayed}", sink.loudestPlayed > 0.1f)
        assertEquals("released with the fade-out still queued", 0f, sink.loudestDiscarded, 0f)
    }
}
