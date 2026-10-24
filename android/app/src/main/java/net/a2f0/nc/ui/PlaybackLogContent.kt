package net.a2f0.nc.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import net.a2f0.nc.NoiseType
import net.a2f0.nc.R
import net.a2f0.nc.diagnostics.PlaybackLog
import java.time.Instant

@Composable
fun PlaybackLogContent(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val log = remember { PlaybackLog.get(context) }
    val entries by log.entries.collectAsStateWithLifecycle()
    val failed by log.storageFailed.collectAsStateWithLifecycle()
    val text = remember(entries, resources) {
        entries.asReversed().joinToString("\n\n") { row ->
            val sound = NoiseType.fromId(row.soundId)?.let { resources.getString(it.title) }.orEmpty()
            val time = Instant.ofEpochMilli(row.timestamp)
            "$time  $sound\n${resources.getString(row.event.title)} [${row.event.name}]\n${row.detail}".trim()
        }
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(SheetSpacing)) {
        Text(stringResource(R.string.playback_log_local))
        if (failed) Text(stringResource(R.string.playback_log_storage_failed))
        TextButton(enabled = entries.isNotEmpty(), onClick = {
            context.startActivity(
                Intent.createChooser(
                    Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, resources.getString(R.string.playback_log) + "\n\n" + text)
                    },
                    resources.getString(R.string.playback_log_share),
                ),
            )
        }) { Text(stringResource(R.string.playback_log_share)) }
        if (entries.isEmpty()) {
            Text(stringResource(R.string.playback_log_empty))
        } else {
            Text(text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
        }
    }
}
