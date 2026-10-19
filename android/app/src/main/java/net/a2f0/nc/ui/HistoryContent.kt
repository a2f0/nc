package net.a2f0.nc.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import net.a2f0.nc.NoiseType
import net.a2f0.nc.R
import net.a2f0.nc.history.ListeningHistory
import net.a2f0.nc.history.historyDays
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.ceil

@Composable
fun HistoryContent() {
    val context = LocalContext.current
    val resources = LocalResources.current
    val locale = LocalConfiguration.current.locales[0]
    val previousLabel = stringResource(R.string.history_previous)
    val nextLabel = stringResource(R.string.history_next)
    val history = remember { ListeningHistory.get(context) }
    val revision by history.revision.collectAsStateWithLifecycle()
    val failed by history.storageFailed.collectAsStateWithLifecycle()
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var tick by remember { mutableLongStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) { delay(15_000); tick++ }
    }
    val days = remember(revision, tick, offset) { historyDays(history.snapshot(), LocalDate.now().plusDays(offset.toLong())) }
    val number = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1 }
    val date = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
    val shortDate = DateTimeFormatter.ofPattern(android.text.format.DateFormat.getBestDateTimePattern(locale, "Md"), locale)
    val totals = days.map { day -> NoiseType.entries.sumOf { day.minutes[it.id] ?: 0.0 } }
    val maximum = maxOf(1.0, ceil(totals.max()))
    val labels = NoiseType.entries.map { stringResource(it.title) }

    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = { offset -= 7 }) { Text("‹", modifier = Modifier.semantics { contentDescription = previousLabel }) }
        TextButton(onClick = { offset = 0 }) { Text(stringResource(R.string.history_today)) }
        TextButton(onClick = { offset = minOf(0, offset + 7) }, enabled = offset < 0) {
            Text("›", modifier = Modifier.semantics { contentDescription = nextLabel })
        }
    }
    Text("${date.format(days.first().date)} – ${date.format(days.last().date)}", style = MaterialTheme.typography.bodyMedium)
    Text(stringResource(R.string.history_minutes), style = MaterialTheme.typography.labelMedium)
    Row(Modifier.fillMaxWidth()) {
        Column(Modifier.height(180.dp).padding(end = 6.dp), verticalArrangement = Arrangement.SpaceBetween, horizontalAlignment = Alignment.End) {
            for (index in 4 downTo 0) Text(number.format(maximum * index / 4), fontSize = 10.sp)
        }
        Column(Modifier.weight(1f)) {
            Box(Modifier.fillMaxWidth().height(180.dp)) {
                Column(Modifier.matchParentSize(), verticalArrangement = Arrangement.SpaceBetween) {
                    repeat(5) { Box(Modifier.fillMaxWidth().height(0.5.dp).background(MaterialTheme.colorScheme.outlineVariant)) }
                }
                Row(Modifier.matchParentSize(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    days.forEach { day ->
                        val description = date.format(day.date) + ". " + NoiseType.entries.mapIndexed { index, type ->
                            resources.getString(R.string.history_value, labels[index], number.format(day.minutes[type.id] ?: 0.0))
                        }.joinToString("; ")
                        Column(
                            Modifier.weight(1f).height(180.dp).semantics { contentDescription = description },
                            verticalArrangement = Arrangement.Bottom,
                        ) {
                            NoiseType.entries.withIndex().reversed().forEach { (index, type) ->
                                val minutes = day.minutes[type.id] ?: 0.0
                                if (minutes > 0) Box(
                                    Modifier.fillMaxWidth().height((180 * minutes / maximum).dp)
                                        .background(HistoryShades[index]).border(0.5.dp, MaterialTheme.colorScheme.outline),
                                )
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                days.forEach { day -> Text(shortDate.format(day.date), fontSize = 9.sp, modifier = Modifier.weight(1f), maxLines = 1) }
            }
            Text(stringResource(R.string.history_date), style = MaterialTheme.typography.labelMedium, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }
    if (totals.all { it == 0.0 }) Text(stringResource(R.string.history_empty))
    NoiseType.entries.forEachIndexed { index, type ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(12.dp).background(HistoryShades[index]).border(0.5.dp, MaterialTheme.colorScheme.outline))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.history_value, labels[index], number.format(days.sumOf { it.minutes[type.id] ?: 0.0 })), style = MaterialTheme.typography.bodyMedium)
        }
    }
    Text(stringResource(R.string.history_local), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (failed) Text(stringResource(R.string.history_storage_failed), style = MaterialTheme.typography.bodySmall)
}
