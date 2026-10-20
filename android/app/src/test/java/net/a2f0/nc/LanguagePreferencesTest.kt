package net.a2f0.nc

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class LanguagePreferencesTest {
    @Test @Config(sdk = [33])
    fun matchesRegionalSystemChoicesAndResolvesDeviceBeforeContextUpdates() {
        val context = RuntimeEnvironment.getApplication() as Context
        val manager = context.getSystemService(android.app.LocaleManager::class.java)
        for ((tag, expected) in listOf("es-MX" to Language.ES, "de-AT" to Language.DE, "en-US" to Language.EN)) {
            manager.applicationLocales = android.os.LocaleList.forLanguageTags(tag)
            assertEquals(expected, LanguagePreferences.selected(context))
            assertEquals(tag, LanguagePreferences.localized(context).resources.configuration.locales[0].toLanguageTag())
        }
        val stale = android.content.res.Configuration(context.resources.configuration).apply {
            setLocale(Locale.GERMAN)
        }
        LanguagePreferences.select(context, Language.DEVICE)
        assertEquals(manager.systemLocales, LanguagePreferences.localized(context.createConfigurationContext(stale)).resources.configuration.locales)
    }

    @Test @Config(sdk = [33])
    fun migratesAnOlderPreferenceOnceAndRespectsAnExistingSystemChoice() {
        val context = RuntimeEnvironment.getApplication() as Context
        val manager = context.getSystemService(android.app.LocaleManager::class.java)
        val preferences = LanguagePreferences.preferences(context)
        preferences.edit().putString(LanguagePreferences.KEY, "de").commit()
        LanguagePreferences.migrate(context)
        assertEquals(Language.DE, LanguagePreferences.selected(context))
        assertEquals(false, preferences.contains(LanguagePreferences.KEY))
        LanguagePreferences.select(context, Language.DEVICE)
        LanguagePreferences.migrate(context)
        assertEquals(Language.DEVICE, LanguagePreferences.selected(context))
        manager.applicationLocales = android.os.LocaleList.forLanguageTags("es-MX")
        preferences.edit().putString(LanguagePreferences.KEY, "de").commit()
        LanguagePreferences.migrate(context)
        assertEquals(Language.ES, LanguagePreferences.selected(context))
    }

    @Test @Config(sdk = [33])
    fun usesTheSystemPerAppSettingOnAndroid13() {
        val context = RuntimeEnvironment.getApplication() as Context
        LanguagePreferences.select(context, Language.DE)
        assertEquals("de", context.getSystemService(android.app.LocaleManager::class.java).applicationLocales[0]?.toLanguageTag())
        assertEquals(Language.DE, LanguagePreferences.selected(context))
        LanguagePreferences.select(context, Language.DEVICE)
        assertEquals(true, context.getSystemService(android.app.LocaleManager::class.java).applicationLocales.isEmpty)
        assertEquals(Language.DEVICE, LanguagePreferences.selected(context))
    }

    @Test fun persistsAndRestoresTheDeviceDefaultOnOlderAndroid() {
        val context = RuntimeEnvironment.getApplication() as Context
        LanguagePreferences.preferences(context).edit().clear().commit()
        val original = context.resources.configuration.locales[0]
        assertEquals(Language.DEVICE, LanguagePreferences.selected(context))
        LanguagePreferences.select(context, Language.DE)
        val fresh = context.createConfigurationContext(context.resources.configuration)
        assertEquals(Language.DE, LanguagePreferences.selected(fresh))
        assertEquals(Locale.GERMAN, LanguagePreferences.localized(fresh).resources.configuration.locales[0])
        assertEquals("Einstellungen", LanguagePreferences.localized(fresh).getString(R.string.settings))
        LanguagePreferences.select(context, Language.DEVICE)
        assertEquals(original, LanguagePreferences.localized(context).resources.configuration.locales[0])
        val spanish = android.content.res.Configuration(context.resources.configuration).apply {
            setLocale(Locale.forLanguageTag("es-ES"))
        }
        assertEquals("Ajustes", LanguagePreferences.localized(context.createConfigurationContext(spanish)).getString(R.string.settings))
    }

    @Test fun invalidStoredTagsFallBackToDevice() {
        val context = RuntimeEnvironment.getApplication() as Context
        LanguagePreferences.preferences(context).edit().putString(LanguagePreferences.KEY, "removed-language").commit()
        assertEquals(Language.DEVICE, LanguagePreferences.selected(context))
    }
}
