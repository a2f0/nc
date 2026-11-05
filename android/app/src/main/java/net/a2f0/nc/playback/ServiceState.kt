package net.a2f0.nc.playback

import net.a2f0.nc.NoiseType

/** What [PlaybackService] is doing. Only [on] changes it. */
internal sealed interface ServiceState {
    data object Stopped : ServiceState

    data class Playing(val type: NoiseType) : ServiceState

    /** Another app holds audio focus for a while (a call, navigation); [type] resumes when it's back. */
    data class PausedForFocusLoss(val type: NoiseType) : ServiceState
}

internal sealed interface ServiceEvent {
    /** Audio focus was granted for [type]. */
    data class Play(val type: NoiseType) : ServiceEvent

    data object Stop : ServiceEvent

    data object FocusLostTransiently : ServiceEvent

    data object FocusGained : ServiceEvent
}

/** The noise the service holds, playing or paused for focus loss. */
internal val ServiceState.noise: NoiseType?
    get() = when (this) {
        ServiceState.Stopped -> null
        is ServiceState.Playing -> type
        is ServiceState.PausedForFocusLoss -> type
    }

/** The service's only state change. Events that don't apply leave the state as it is. */
internal fun ServiceState.on(event: ServiceEvent): ServiceState = when (event) {
    is ServiceEvent.Play -> ServiceState.Playing(event.type)

    ServiceEvent.Stop -> ServiceState.Stopped

    ServiceEvent.FocusLostTransiently -> when (this) {
        is ServiceState.Playing -> ServiceState.PausedForFocusLoss(type)
        ServiceState.Stopped, is ServiceState.PausedForFocusLoss -> this
    }

    ServiceEvent.FocusGained -> when (this) {
        is ServiceState.PausedForFocusLoss -> ServiceState.Playing(type)
        ServiceState.Stopped, is ServiceState.Playing -> this
    }
}
