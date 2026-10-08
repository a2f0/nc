package net.a2f0.nc

import androidx.annotation.StringRes

enum class NoiseType(
    /** Stable identifier for intents; survives R8 renaming and app updates. */
    val id: String,
    @StringRes val title: Int,
    @StringRes val shortTitle: Int,
    @StringRes val blurb: Int,
) {
    WHITE("white", R.string.noise_white_title, R.string.noise_white_short, R.string.noise_white_blurb),
    PINK("pink", R.string.noise_pink_title, R.string.noise_pink_short, R.string.noise_pink_blurb),
    BROWN("brown", R.string.noise_brown_title, R.string.noise_brown_short, R.string.noise_brown_blurb),
    WAVES("waves", R.string.noise_waves_title, R.string.noise_waves_short, R.string.noise_waves_blurb),
    FAN("fan", R.string.noise_fan_title, R.string.noise_fan_short, R.string.noise_fan_blurb),
    ;

    companion object {
        fun fromId(id: String?): NoiseType? = entries.find { it.id == id }
    }
}
