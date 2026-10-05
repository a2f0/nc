package net.a2f0.nc

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import net.a2f0.nc.ui.NoiseConnoisseurTheme
import net.a2f0.nc.ui.NoiseScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            NoiseConnoisseurTheme { NoiseScreen() }
        }
    }
}
