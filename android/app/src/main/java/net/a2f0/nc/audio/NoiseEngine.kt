package net.a2f0.nc.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Process
import net.a2f0.nc.NoiseType
import kotlin.math.min

/**
 * Streams generated stereo noise ([NoiseMixer]) to an [AudioTrack] on a dedicated thread.
 * Starting fades in and stopping fades out, so neither clicks. Switching noise type while
 * playing is instant.
 */
internal class NoiseEngine {
    private val lock = Any()
    private var thread: Thread? = null

    @Volatile private var type = NoiseType.WHITE
    @Volatile private var fadingOut = false
    @Volatile private var targetVolumeGain = 1f

    fun play(type: NoiseType) = synchronized(lock) {
        this.type = type
        fadingOut = false
        if (thread == null) {
            thread = Thread(::run, "NoiseEngine").also { it.start() }
        }
    }

    /** Begins a fade-out; the audio thread releases the track and exits once it's silent. */
    fun stop() = synchronized(lock) {
        if (thread != null) fadingOut = true
    }

    /** [volume] runs from 0 to 1; see [volumeGain]. */
    fun setVolume(volume: Float) {
        targetVolumeGain = volumeGain(volume)
    }

    private fun run() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)

        val minBufferBytes = AudioTrack.getMinBufferSize(SAMPLE_RATE, CHANNEL_MASK, ENCODING)
        val track = AudioTrack.Builder()
            .setAudioAttributes(ATTRIBUTES)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(ENCODING)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(CHANNEL_MASK)
                    .build(),
            )
            // The power-saving ("deep buffer") output, which media players' longer buffers
            // also get: it plays longer stretches between wakeups, so the processor sleeps
            // more. The system enlarges the buffer to suit it.
            .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_POWER_SAVING)
            .setBufferSizeInBytes(minBufferBytes * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        val mixer = NoiseMixer(
            SAMPLE_RATE,
            leftSeed = System.nanoTime().toInt(),
            rightSeed = System.nanoTime().toInt() xor 0x5bd1e995,
            volumeGain = targetVolumeGain,
        )
        val buffer = FloatArray(FRAMES_PER_WRITE * 2)

        track.play()
        try {
            while (true) {
                mixer.render(buffer, type, fadingOut, targetVolumeGain)
                if (track.write(buffer, 0, buffer.size, AudioTrack.WRITE_BLOCKING) < 0) break

                if (mixer.fade == 0f && fadingOut) {
                    val exit = synchronized(lock) {
                        fadingOut.also { if (it) thread = null }
                    }
                    if (exit) {
                        // Releasing the track discards what's queued, so push the
                        // fade-out through with a buffer's worth of silence first.
                        buffer.fill(0f)
                        var silentFrames = track.bufferSizeInFrames
                        while (silentFrames > 0) {
                            val frames = min(silentFrames, FRAMES_PER_WRITE)
                            if (track.write(buffer, 0, frames * 2, AudioTrack.WRITE_BLOCKING) < 0) break
                            silentFrames -= frames
                        }
                        break
                    }
                }
            }
        } finally {
            synchronized(lock) {
                if (thread == Thread.currentThread()) thread = null
            }
            track.stop()
            track.release()
        }
    }

    companion object {
        val ATTRIBUTES: AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()

        private const val SAMPLE_RATE = 48_000
        private const val CHANNEL_MASK = AudioFormat.CHANNEL_OUT_STEREO
        private const val ENCODING = AudioFormat.ENCODING_PCM_FLOAT
        private const val FRAMES_PER_WRITE = 1_024
    }
}
