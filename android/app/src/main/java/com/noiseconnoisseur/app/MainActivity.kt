package com.noiseconnoisseur.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.noiseconnoisseur.app.ui.NoiseConnoisseurTheme
import com.noiseconnoisseur.app.ui.NoiseScreen

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
