package net.a2f0.nc

import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import net.a2f0.nc.playback.NoisePlayer
import net.a2f0.nc.ui.AppearancePreferences
import net.a2f0.nc.ui.LocalAppearancePreferences
import net.a2f0.nc.ui.NoiseConnoisseurTheme
import net.a2f0.nc.ui.NoiseScreen

class MainActivity : ComponentActivity() {
    override fun attachBaseContext(base: Context) {
        LanguagePreferences.migrate(base)
        super.attachBaseContext(if (Build.VERSION.SDK_INT < 33) LanguagePreferences.localized(base) else base)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        // Edge to edge without enableEdgeToEdge(), whose fallbacks for older Android versions call
        // the deprecated APIs Google Play flags. The theme makes the system bars transparent and
        // lets the app into display cutouts; Android 15 and later draw edge to edge anyway.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        NoisePlayer.refreshWidgets(applicationContext)
        setContent {
            val preferences = remember {
                AppearancePreferences(getSharedPreferences("appearance", MODE_PRIVATE))
            }
            val dark = preferences.appearance.isDark(isSystemInDarkTheme())
            SideEffect {
                WindowCompat.getInsetsController(window, window.decorView).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
            val languages = remember {
                LanguageControl(LanguagePreferences.selected(this)) { language ->
                    LanguagePreferences.select(this, language)
                    NoisePlayer.refreshWidgets(applicationContext)
                    if (Build.VERSION.SDK_INT < 33) recreate()
                }
            }
            CompositionLocalProvider(LocalAppearancePreferences provides preferences, LocalLanguageControl provides languages) {
                NoiseConnoisseurTheme(darkTheme = dark) { NoiseScreen() }
            }
        }
    }
}
