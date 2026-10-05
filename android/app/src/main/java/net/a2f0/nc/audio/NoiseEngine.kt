package net.a2f0.nc.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Process
import net.a2f0.nc.NoiseType
import kotlin.math.max
import kotlin.math.min

/**
 * Streams generated stereo noise to an [AudioTrack] on a dedicated thread. Starting fades
 * in and stopping fades out, so neither clicks. Switching noise type while playing is
 * instant.
 */
internal class NoiseEngine {
    private val lock = Any()
    private var thread: Thread? = null

    @Volatile private var type = NoiseType.WHITE
    @Volatile private var fadingOut = false
    @Volatile private var volumeGain = 1f

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

    /**
     * [volume] runs from 0 to 1. The gain is its square, which tracks perceived loudness
     * better than a straight line: halfway is about -12 dB.
     */
    fun setVolume(volume: Float) {
        val clamped = volume.coerceIn(0f, 1f)
        volumeGain = clamped * clamped
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
            .setBufferSizeInBytes(minBufferBytes * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        // Independent generators per channel give a wide, decorrelated stereo image.
        val left = NoiseGenerator(seed = System.nanoTime().toInt())
        val right = NoiseGenerator(seed = System.nanoTime().toInt() xor 0x5bd1e995)
        val buffer = FloatArray(FRAMES_PER_WRITE * 2)
        val gainStep = 1f / (SAMPLE_RATE * FADE_SECONDS)
        val volumeStep = 1f / (SAMPLE_RATE * VOLUME_RAMP_SECONDS)
        var gain = 0f
        var volume = volumeGain

        track.play()
        try {
            while (true) {
                val type = type
                val target = if (fadingOut) 0f else 1f
                val targetVolume = volumeGain
                for (frame in 0 until FRAMES_PER_WRITE) {
                    gain = if (gain < target) min(gain + gainStep, target) else max(gain - gainStep, target)
                    volume = if (volume < targetVolume) {
                        min(volume + volumeStep, targetVolume)
                    } else {
                        max(volume - volumeStep, targetVolume)
                    }
                    buffer[frame * 2] = left.next(type) * gain * volume
                    buffer[frame * 2 + 1] = right.next(type) * gain * volume
                }
                if (track.write(buffer, 0, buffer.size, AudioTrack.WRITE_BLOCKING) < 0) break

                if (gain == 0f && fadingOut) {
                    val exit = synchronized(lock) {
                        fadingOut.also { if (it) thread = null }
                    }
                    if (exit) {
                        // Let the queued fade-out drain before stopping.
                        buffer.fill(0f)
                        track.write(buffer, 0, buffer.size, AudioTrack.WRITE_BLOCKING)
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
        private const val FADE_SECONDS = 0.4f

        /** How long a volume change takes to reach its new level, so dragging doesn't crackle. */
        private const val VOLUME_RAMP_SECONDS = 0.05f
    }
}
