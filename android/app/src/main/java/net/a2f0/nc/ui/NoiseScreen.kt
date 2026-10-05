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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import net.a2f0.nc.NoiseType
import net.a2f0.nc.R
import net.a2f0.nc.playback.NoisePlayer

@Composable
fun NoiseConnoisseurTheme(content: @Composable () -> Unit) {
    // Neutral grays rather than Material's default purple tint.
    val colors = if (isSystemInDarkTheme()) {
        darkColorScheme(
            primary = Color.White,
            onPrimary = Color.Black,
            background = Color.Black,
            surface = Color(0xFF1C1C1E),
            surfaceVariant = Color(0xFF2C2C2E),
            onSurfaceVariant = Color(0xFFAEAEB2),
            outlineVariant = Color(0xFF38383A),
        )
    } else {
        lightColorScheme(
            primary = Color(0xFF1C1C1E),
            onPrimary = Color.White,
            background = Color.White,
            surface = Color.White,
            surfaceVariant = Color(0xFFF2F2F7),
            onSurfaceVariant = Color(0xFF6C6C70),
            outlineVariant = Color(0xFFE5E5EA),
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}

@Composable
fun NoiseScreen() {
    val context = LocalContext.current
    val nowPlaying by NoisePlayer.nowPlaying.collectAsStateWithLifecycle()
    NoiseScreen(nowPlaying = nowPlaying, onToggle = { NoisePlayer.toggle(context, it) })
}

@Composable
private fun NoiseScreen(nowPlaying: NoiseType?, onToggle: (NoiseType) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .safeDrawingPadding()
                .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text = stringResource(R.string.app_name),
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = nowPlaying?.let { stringResource(R.string.playing) + " · " + stringResource(it.title) }
                    ?: stringResource(R.string.stopped),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            NoiseType.entries.forEach { type ->
                NoiseCard(type = type, isPlaying = type == nowPlaying, onClick = { onToggle(type) })
            }
        }
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
    NoiseConnoisseurTheme { NoiseScreen(nowPlaying = NoiseType.PINK, onToggle = {}) }
}
