package net.a2f0.nc

import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.core.content.edit
import java.util.Locale

/** Android 13+ shares the system per-app setting. Older devices use a private preference. */
object LanguagePreferences {
    const val KEY = "language"
    fun preferences(context: Context) = context.getSharedPreferences(KEY, Context.MODE_PRIVATE)

    fun selected(context: Context): Language {
        val tag = if (Build.VERSION.SDK_INT >= 33) {
            context.getSystemService(LocaleManager::class.java).applicationLocales[0]?.toLanguageTag()
        } else preferences(context).getString(KEY, null)
        return Language.fromTag(tag)
    }

    fun select(context: Context, language: Language) {
        if (Build.VERSION.SDK_INT >= 33) {
            context.getSystemService(LocaleManager::class.java).applicationLocales =
                if (language == Language.DEVICE) LocaleList.getEmptyLocaleList()
                else LocaleList.forLanguageTags(language.tag)
        } else {
            preferences(context).edit { putString(KEY, language.tag) }
        }
    }

    /** Also used by notifications and widgets, whose contexts aren't the activity's. */
    fun localized(context: Context): Context {
        val language = selected(context)
        if (language == Language.DEVICE) return context
        val config = Configuration(context.resources.configuration)
        config.setLocale(Locale.forLanguageTag(language.tag))
        return context.createConfigurationContext(config)
    }
}

data class LanguageControl(val selected: Language, val select: (Language) -> Unit)
val LocalLanguageControl = staticCompositionLocalOf { LanguageControl(Language.DEVICE) {} }
