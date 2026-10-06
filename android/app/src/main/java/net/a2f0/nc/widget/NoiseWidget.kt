package net.a2f0.nc.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
import androidx.glance.Button
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.LocalContext
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartService
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import net.a2f0.nc.NoiseType
import net.a2f0.nc.R
import net.a2f0.nc.playback.NoisePlayer
import net.a2f0.nc.playback.PlaybackService
import net.a2f0.nc.ui.DarkColors
import net.a2f0.nc.ui.LightColors

/** Home screen widget with a start/stop button for each noise. */
class NoiseWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val nowPlaying by NoisePlayer.nowPlaying.collectAsState()
            // The app's grays, not the wallpaper's dynamic colors.
            GlanceTheme(colors = ColorProviders(light = LightColors, dark = DarkColors)) { Content(nowPlaying) }
        }
    }

    @Composable
    private fun Content(nowPlaying: NoiseType?) {
        val context = LocalContext.current
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .appWidgetBackground()
                .background(GlanceTheme.colors.widgetBackground)
                .cornerRadius(16.dp)
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = context.getString(R.string.app_name),
                style = TextStyle(fontWeight = FontWeight.Medium, color = GlanceTheme.colors.onSurface),
                maxLines = 1,
            )
            NoiseType.entries.forEach { type ->
                val isPlaying = type == nowPlaying
                Spacer(GlanceModifier.height(8.dp))
                Button(
                    text = (if (isPlaying) "■  " else "▶  ") + context.getString(type.shortTitle),
                    onClick = if (isPlaying) {
                        actionRunCallback<StopNoiseAction>()
                    } else {
                        // Widget taps may start a foreground service directly, even from the background.
                        actionStartService(PlaybackService.playIntent(context, type), isForegroundService = true)
                    },
                    modifier = GlanceModifier.fillMaxWidth(),
                )
            }
        }
    }
}

class StopNoiseAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        NoisePlayer.stop(context)
        // Covers a stale widget (e.g. the process died): re-render with the real state.
        NoiseWidget().update(context, glanceId)
    }
}

class NoiseWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NoiseWidget()
}
