package com.noiseconnoisseur.app

import androidx.annotation.StringRes

enum class NoiseType(
    @StringRes val title: Int,
    @StringRes val shortTitle: Int,
    @StringRes val blurb: Int,
) {
    WHITE(R.string.noise_white, R.string.noise_white_short, R.string.noise_white_blurb),
    PINK(R.string.noise_pink, R.string.noise_pink_short, R.string.noise_pink_blurb),
}
