package net.a2f0.nc.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import net.a2f0.nc.NoiseType
import net.a2f0.nc.R
import net.a2f0.nc.playback.NoisePlayer

@Composable
fun NoiseConnoisseurTheme(content: @Composable () -> Unit) {
    // Grays only (see Colors.kt), not Material's purples or the wallpaper's colors.
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors, content = content)
}

@Composable
fun NoiseScreen() {
    val context = LocalContext.current
    val nowPlaying by NoisePlayer.nowPlaying.collectAsStateWithLifecycle()
    val volume by remember { NoisePlayer.volume(context) }.collectAsStateWithLifecycle()
    NoiseScreen(
        nowPlaying = nowPlaying,
        onToggle = { NoisePlayer.toggle(context, it) },
        volume = volume,
        onVolumeChange = { NoisePlayer.setVolume(context, it) },
    )
}

@Composable
private fun NoiseScreen(
    nowPlaying: NoiseType?,
    onToggle: (NoiseType) -> Unit,
    volume: Float,
    onVolumeChange: (Float) -> Unit,
) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = stringResource(R.string.app_name),
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = nowPlaying?.let { stringResource(R.string.status_playing, stringResource(it.title)) }
                    ?: stringResource(R.string.status_tap_to_start),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            NoiseType.entries.forEach { type ->
                NoiseCard(type = type, isPlaying = type == nowPlaying, onClick = { onToggle(type) })
            }
            Spacer(Modifier.height(8.dp))
            VolumeSlider(volume = volume, onVolumeChange = onVolumeChange)
        }
    }
}

@Composable
private fun VolumeSlider(volume: Float, onVolumeChange: (Float) -> Unit) {
    val description = stringResource(R.string.volume)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.padding(horizontal = 4.dp),
    ) {
        Icon(
            painterResource(R.drawable.ic_volume_low),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Slider(
            value = volume,
            onValueChange = onVolumeChange,
            colors = SliderDefaults.colors(
                thumbColor = MaterialTheme.colorScheme.onSurface,
                activeTrackColor = MaterialTheme.colorScheme.onSurface,
                inactiveTrackColor = MaterialTheme.colorScheme.surfaceVariant,
            ),
            modifier = Modifier
                .weight(1f)
                .semantics { contentDescription = description },
        )
        Icon(
            painterResource(R.drawable.ic_volume_high),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun NoiseCard(type: NoiseType, isPlaying: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            width = if (isPlaying) 2.dp else 1.dp,
            color = if (isPlaying) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outlineVariant,
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(modifier = Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(stringResource(type.title), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(4.dp))
                Text(
                    stringResource(type.blurb),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(16.dp))
            Surface(
                shape = CircleShape,
                color = if (isPlaying) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.size(48.dp),
            ) {
                Text(
                    text = if (isPlaying) "■" else "▶",
                    color = if (isPlaying) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.wrapContentSize(Alignment.Center),
                )
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun NoiseScreenPreview() {
    NoiseConnoisseurTheme {
        NoiseScreen(nowPlaying = NoiseType.PINK, onToggle = {}, volume = 0.7f, onVolumeChange = {})
    }
}
