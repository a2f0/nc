package net.a2f0.nc

import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale

/** Android 13+ shares the system per-app setting. Older devices use a private preference. */
object LanguagePreferences {
    const val KEY = "language"
    private val effectiveLocales = MutableStateFlow("")

    /** Existing Glance sessions collect this instead of waiting for another playback change. */
    fun locales(context: Context): StateFlow<String> {
        refresh(context)
        return effectiveLocales.asStateFlow()
    }

    fun refresh(context: Context) {
        effectiveLocales.value = resolvedLocales(context).toLanguageTags()
    }

    fun preferences(context: Context) = context.getSharedPreferences(KEY, Context.MODE_PRIVATE)

    fun selected(context: Context): Language {
        if (Build.VERSION.SDK_INT < 33) return Language.fromTag(preferences(context).getString(KEY, null))
        val locale = context.getSystemService(LocaleManager::class.java).applicationLocales[0] ?: return Language.DEVICE
        val exact = Language.fromTag(locale.toLanguageTag())
        if (exact != Language.DEVICE) return exact
        return Language.entries.firstOrNull {
            val candidate = Locale.forLanguageTag(it.tag)
            it != Language.DEVICE && candidate.language == locale.language &&
                (candidate.script.isEmpty() || candidate.script == locale.script)
        } ?: Language.DEVICE
    }

    /** Preserve an older installation's preference on its first launch after an OS upgrade. */
    fun migrate(context: Context) {
        if (Build.VERSION.SDK_INT < 33) return
        val saved = preferences(context)
        if (!saved.contains(KEY)) return
        val language = Language.fromTag(saved.getString(KEY, null))
        val manager = context.getSystemService(LocaleManager::class.java)
        if (manager.applicationLocales.isEmpty && language != Language.DEVICE) {
            manager.applicationLocales = LocaleList.forLanguageTags(language.tag)
        }
        saved.edit { remove(KEY) }
    }

    fun select(context: Context, language: Language) {
        if (Build.VERSION.SDK_INT >= 33) {
            context.getSystemService(LocaleManager::class.java).applicationLocales =
                if (language == Language.DEVICE) LocaleList.getEmptyLocaleList()
                else LocaleList.forLanguageTags(language.tag)
        } else {
            preferences(context).edit { putString(KEY, language.tag) }
        }
        refresh(context)
    }

    private fun resolvedLocales(context: Context): LocaleList {
        if (Build.VERSION.SDK_INT >= 33) {
            val manager = context.getSystemService(LocaleManager::class.java)
            val locales = manager.applicationLocales
            return if (locales.isEmpty) manager.systemLocales else locales
        }
        val language = selected(context)
        return if (language == Language.DEVICE) context.resources.configuration.locales
            else LocaleList.forLanguageTags(language.tag)
    }

    /** Also used by notifications and widgets, whose contexts aren't the activity's. */
    fun localized(context: Context, tags: String? = null): Context {
        val config = Configuration(context.resources.configuration)
        config.setLocales(if (tags == null) resolvedLocales(context) else LocaleList.forLanguageTags(tags))
        return context.createConfigurationContext(config)
    }
}

data class LanguageControl(val selected: Language, val select: (Language) -> Unit)
val LocalLanguageControl = staticCompositionLocalOf { LanguageControl(Language.DEVICE) {} }
