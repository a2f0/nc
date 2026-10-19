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
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
import net.a2f0.nc.history.historyTotals
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.ceil

private data class HistoryBar(val label: String, val description: String, val minutes: Map<String, Double>)

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
    var allTime by rememberSaveable { mutableStateOf(false) }
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var tick by remember { mutableLongStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) { delay(15_000); tick++ }
    }
    val sessions = remember(revision, tick) { history.snapshot() }
    val days = historyDays(sessions, LocalDate.now().plusDays(offset.toLong()))
    val soundTotals = if (allTime) historyTotals(sessions) else NoiseType.entries.associate { type ->
        type.id to days.sumOf { it.minutes[type.id] ?: 0.0 }
    }
    val number = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1 }
    val date = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
    val shortDate = DateTimeFormatter.ofPattern(android.text.format.DateFormat.getBestDateTimePattern(locale, "Md"), locale)
    val labels = NoiseType.entries.map { stringResource(it.title) }

    val bars = if (allTime) NoiseType.entries.mapIndexed { index, type ->
        HistoryBar(stringResource(type.shortTitle),
            resources.getString(R.string.history_value, labels[index], number.format(soundTotals[type.id] ?: 0.0)),
            mapOf(type.id to (soundTotals[type.id] ?: 0.0)))
    } else days.map { day ->
        HistoryBar(shortDate.format(day.date), date.format(day.date) + ". " + NoiseType.entries.mapIndexed { index, type ->
            resources.getString(R.string.history_value, labels[index], number.format(day.minutes[type.id] ?: 0.0))
        }.joinToString("; "), day.minutes)
    }
    val totals = bars.map { bar -> NoiseType.entries.sumOf { bar.minutes[it.id] ?: 0.0 } }
    val maximum = maxOf(1.0, ceil(totals.max()))

    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = allTime, onClick = { allTime = true }, modifier = Modifier.weight(1f),
            label = { Text(stringResource(R.string.history_all_time)) })
        FilterChip(selected = !allTime, onClick = { allTime = false }, modifier = Modifier.weight(1f),
            label = { Text(stringResource(R.string.history_calendar)) })
    }
    if (!allTime) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { offset -= 7 }) { Text("‹", modifier = Modifier.semantics { contentDescription = previousLabel }) }
            TextButton(onClick = { offset = 0 }) { Text(stringResource(R.string.history_today)) }
            TextButton(onClick = { offset = minOf(0, offset + 7) }, enabled = offset < 0) {
                Text("›", modifier = Modifier.semantics { contentDescription = nextLabel })
            }
        }
        Text("${date.format(days.first().date)} – ${date.format(days.last().date)}", style = MaterialTheme.typography.bodyMedium)
    }
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
                    bars.forEach { bar ->
                        Column(
                            Modifier.weight(1f).height(180.dp).semantics { contentDescription = bar.description },
                            verticalArrangement = Arrangement.Bottom,
                        ) {
                            NoiseType.entries.withIndex().reversed().forEach { (index, type) ->
                                val minutes = bar.minutes[type.id] ?: 0.0
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
                bars.forEach { bar -> Text(bar.label, fontSize = 9.sp, modifier = Modifier.weight(1f), maxLines = 1) }
            }
            Text(stringResource(if (allTime) R.string.history_sound else R.string.history_date), style = MaterialTheme.typography.labelMedium, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }
    if (totals.all { it == 0.0 }) Text(stringResource(if (allTime) R.string.history_all_time_empty else R.string.history_empty))
    NoiseType.entries.forEachIndexed { index, type ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(12.dp).background(HistoryShades[index]).border(0.5.dp, MaterialTheme.colorScheme.outline))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.history_value, labels[index], number.format(soundTotals[type.id] ?: 0.0)), style = MaterialTheme.typography.bodyMedium)
        }
    }
    Text(stringResource(R.string.history_local), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (failed) Text(stringResource(R.string.history_storage_failed), style = MaterialTheme.typography.bodySmall)
}
