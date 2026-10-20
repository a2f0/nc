package net.a2f0.nc.ui

import android.content.SharedPreferences
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.content.edit
import net.a2f0.nc.R

/** Stable preference values, independent of translated labels and R8 enum names. */
enum class Appearance(val id: String, @StringRes val title: Int) {
    SYSTEM("system", R.string.appearance_system),
    LIGHT("light", R.string.appearance_light),
    DARK("dark", R.string.appearance_dark);

    fun isDark(systemDark: Boolean): Boolean = when (this) {
        SYSTEM -> systemDark
        LIGHT -> false
        DARK -> true
    }

    companion object {
        fun fromId(id: String?): Appearance = entries.find { it.id == id } ?: SYSTEM
    }
}

class AppearancePreferences(private val preferences: SharedPreferences) {
    var appearance by mutableStateOf(Appearance.fromId(preferences.getString("appearance", null)))
        private set

    fun select(value: Appearance) {
        preferences.edit { putString("appearance", value.id) }
        appearance = value
    }
}

val LocalAppearancePreferences = staticCompositionLocalOf<AppearancePreferences> {
    error("Appearance preferences must be provided by the app")
}
