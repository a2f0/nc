package net.a2f0.nc.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

// Nothing in the app has color (see AGENTS.md): these are grays, with equal red,
// green, and blue, matching the iOS and web apps. Roles the app doesn't set are
// turned gray too, so no component falls back to Material's baseline purples.

internal val LightColors: ColorScheme = lightColorScheme(
    primary = Color(0xFF1C1C1C),
    onPrimary = Color.White,
    background = Color.White,
    onBackground = Color(0xFF1C1C1C),
    surface = Color.White,
    onSurface = Color(0xFF1C1C1C),
    surfaceVariant = Color(0xFFF2F2F2),
    onSurfaceVariant = Color(0xFF6C6C6C),
    outlineVariant = Color(0xFFE5E5E5),
    // The home screen widget's background (Glance's widgetBackground).
    secondaryContainer = Color.White,
    onSecondaryContainer = Color(0xFF1C1C1C),
).grayscale()

internal val DarkColors: ColorScheme = darkColorScheme(
    primary = Color.White,
    onPrimary = Color.Black,
    background = Color.Black,
    onBackground = Color.White,
    surface = Color(0xFF1C1C1C),
    onSurface = Color.White,
    surfaceVariant = Color(0xFF2C2C2C),
    onSurfaceVariant = Color(0xFFAEAEAE),
    outlineVariant = Color(0xFF383838),
    secondaryContainer = Color(0xFF1C1C1C),
    onSecondaryContainer = Color.White,
).grayscale()

/** A gray with the color's luma (Rec. 709 weights), so grays stay as they are. */
internal fun Color.toGray(): Color {
    val luma = 0.2126f * red + 0.7152f * green + 0.0722f * blue
    return Color(luma, luma, luma, alpha)
}

private fun ColorScheme.grayscale(): ColorScheme = copy(
    primary = primary.toGray(),
    onPrimary = onPrimary.toGray(),
    primaryContainer = primaryContainer.toGray(),
    onPrimaryContainer = onPrimaryContainer.toGray(),
    inversePrimary = inversePrimary.toGray(),
    secondary = secondary.toGray(),
    onSecondary = onSecondary.toGray(),
    secondaryContainer = secondaryContainer.toGray(),
    onSecondaryContainer = onSecondaryContainer.toGray(),
    tertiary = tertiary.toGray(),
    onTertiary = onTertiary.toGray(),
    tertiaryContainer = tertiaryContainer.toGray(),
    onTertiaryContainer = onTertiaryContainer.toGray(),
    background = background.toGray(),
    onBackground = onBackground.toGray(),
    surface = surface.toGray(),
    onSurface = onSurface.toGray(),
    surfaceVariant = surfaceVariant.toGray(),
    onSurfaceVariant = onSurfaceVariant.toGray(),
    surfaceTint = surfaceTint.toGray(),
    inverseSurface = inverseSurface.toGray(),
    inverseOnSurface = inverseOnSurface.toGray(),
    error = error.toGray(),
    onError = onError.toGray(),
    errorContainer = errorContainer.toGray(),
    onErrorContainer = onErrorContainer.toGray(),
    outline = outline.toGray(),
    outlineVariant = outlineVariant.toGray(),
    scrim = scrim.toGray(),
    surfaceBright = surfaceBright.toGray(),
    surfaceDim = surfaceDim.toGray(),
    surfaceContainer = surfaceContainer.toGray(),
    surfaceContainerHigh = surfaceContainerHigh.toGray(),
    surfaceContainerHighest = surfaceContainerHighest.toGray(),
    surfaceContainerLow = surfaceContainerLow.toGray(),
    surfaceContainerLowest = surfaceContainerLowest.toGray(),
    primaryFixed = primaryFixed.toGray(),
    primaryFixedDim = primaryFixedDim.toGray(),
    onPrimaryFixed = onPrimaryFixed.toGray(),
    onPrimaryFixedVariant = onPrimaryFixedVariant.toGray(),
    secondaryFixed = secondaryFixed.toGray(),
    secondaryFixedDim = secondaryFixedDim.toGray(),
    onSecondaryFixed = onSecondaryFixed.toGray(),
    onSecondaryFixedVariant = onSecondaryFixedVariant.toGray(),
    tertiaryFixed = tertiaryFixed.toGray(),
    tertiaryFixedDim = tertiaryFixedDim.toGray(),
    onTertiaryFixed = onTertiaryFixed.toGray(),
    onTertiaryFixedVariant = onTertiaryFixedVariant.toGray(),
)
