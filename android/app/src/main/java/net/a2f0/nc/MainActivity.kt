package net.a2f0.nc

import android.os.Bundle
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import net.a2f0.nc.ui.AppearancePreferences
import net.a2f0.nc.ui.LocalAppearancePreferences
import net.a2f0.nc.ui.NoiseConnoisseurTheme
import net.a2f0.nc.ui.NoiseScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setContent {
            val preferences = remember {
                AppearancePreferences(getSharedPreferences("appearance", MODE_PRIVATE))
            }
            val dark = preferences.appearance.isDark(isSystemInDarkTheme())
            SideEffect {
                enableEdgeToEdge(
                    statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT) { dark },
                    navigationBarStyle = SystemBarStyle.auto(0xffe6e6e6.toInt(), 0x801b1b1b.toInt()) { dark },
                )
            }
            CompositionLocalProvider(LocalAppearancePreferences provides preferences) {
                NoiseConnoisseurTheme(darkTheme = dark) { NoiseScreen() }
            }
        }
    }
}
