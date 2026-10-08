package net.a2f0.nc.widget

import android.content.Context
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
import androidx.glance.ButtonDefaults
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartService
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.components.FilledButton
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
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
                .systemCornerRadius()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = context.getString(R.string.app_name),
                style = TextStyle(fontWeight = FontWeight.Medium, color = GlanceTheme.colors.onSurface),
                maxLines = 1,
            )
            Spacer(GlanceModifier.height(8.dp))
            // Scrolls when the widget is too short for every sound.
            LazyColumn(modifier = GlanceModifier.fillMaxWidth().defaultWeight()) {
                items(NoiseType.entries, itemId = { it.ordinal.toLong() }) { type ->
                    Box(modifier = GlanceModifier.fillMaxWidth().padding(top = if (type.ordinal == 0) 0.dp else 8.dp)) {
                        NoiseButton(type, isPlaying = type == nowPlaying)
                    }
                }
            }
        }
    }

    @Composable
    private fun NoiseButton(type: NoiseType, isPlaying: Boolean) {
        val context = LocalContext.current
        // Filled while playing, like the app's play/stop buttons.
        FilledButton(
            text = context.getString(type.shortTitle),
            icon = ImageProvider(if (isPlaying) R.drawable.ic_stop else R.drawable.ic_play),
            colors = if (isPlaying) {
                ButtonDefaults.buttonColors()
            } else {
                ButtonDefaults.buttonColors(
                    backgroundColor = GlanceTheme.colors.surfaceVariant,
                    contentColor = GlanceTheme.colors.onSurface,
                )
            },
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

/** The launcher's widget corner radius. Widgets have rounded corners on Android 12 and later. */
private fun GlanceModifier.systemCornerRadius(): GlanceModifier =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) cornerRadius(android.R.dimen.system_app_widget_background_radius) else this

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
