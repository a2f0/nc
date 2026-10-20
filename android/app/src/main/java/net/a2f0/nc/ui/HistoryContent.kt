package net.a2f0.nc.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.ceil
import net.a2f0.nc.NoiseType
import net.a2f0.nc.R
import net.a2f0.nc.history.ListeningHistory
import net.a2f0.nc.history.historyDays
import net.a2f0.nc.history.historyTotals

private data class HistoryBar(val label: String, val description: String, val minutes: Map<String, Double>)

@Composable
fun HistoryContent(onNavigate: () -> Unit) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val locale = LocalConfiguration.current.locales[0]
    val previousLabel = stringResource(R.string.history_previous)
    val nextLabel = stringResource(R.string.history_next)
    val history = remember { ListeningHistory.get(context) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val updates = remember(history, lifecycle) { historyUpdates(history, lifecycle) }
    val update by updates.collectAsState(initial = remember(history) { HistoryUpdate(history.snapshot(), System.currentTimeMillis()) })
    val failed by history.storageFailed.collectAsStateWithLifecycle(minActiveState = Lifecycle.State.RESUMED)
    var allTime by rememberSaveable { mutableStateOf(false) }
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var selectedSoundId by rememberSaveable { mutableStateOf<String?>(null) }
    var detailOffset by rememberSaveable { mutableIntStateOf(0) }
    val selectedSound = NoiseType.fromId(selectedSoundId)
    val showAllTime = allTime && selectedSound == null
    val activeOffset = if (selectedSound == null) offset else detailOffset
    val sounds = selectedSound?.let { listOf(it) } ?: NoiseType.entries
    val sessions = remember(update.sessions, selectedSound) {
        update.sessions.filter { selectedSound == null || it.soundId == selectedSound.id }
    }
    fun move(days: Int?) {
        if (selectedSound == null) offset = days?.let { minOf(0, offset + it) } ?: 0
        else detailOffset = days?.let { minOf(0, detailOffset + it) } ?: 0
    }
    fun back() { selectedSoundId = null; onNavigate() }
    BackHandler(enabled = selectedSound != null) { back() }
    val zone = ZoneId.systemDefault()
    val endDay = Instant.ofEpochMilli(update.refreshedAt).atZone(zone).toLocalDate().plusDays(activeOffset.toLong())
    val days = remember(sessions, endDay, zone, showAllTime) {
        if (showAllTime) emptyList() else historyDays(sessions, endDay, zone)
    }
    val soundTotals = remember(sessions, days, showAllTime) {
        if (showAllTime) historyTotals(sessions) else NoiseType.entries.associate { type ->
            type.id to days.sumOf { it.minutes[type.id] ?: 0.0 }
        }
    }
    val number = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1 }
    val date = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
    val shortDate = DateTimeFormatter.ofPattern(android.text.format.DateFormat.getBestDateTimePattern(locale, "Md"), locale)
    val labels = NoiseType.entries.map { stringResource(it.title) }

    val bars = if (showAllTime) NoiseType.entries.mapIndexed { index, type ->
        HistoryBar(stringResource(type.shortTitle),
            resources.getString(R.string.history_value, labels[index], number.format(soundTotals[type.id] ?: 0.0)),
            mapOf(type.id to (soundTotals[type.id] ?: 0.0)))
    } else days.map { day ->
        HistoryBar(shortDate.format(day.date), date.format(day.date) + ". " + sounds.map { type ->
            resources.getString(R.string.history_value, resources.getString(type.title), number.format(day.minutes[type.id] ?: 0.0))
        }.joinToString("; "), day.minutes)
    }
    val totals = bars.map { bar -> NoiseType.entries.sumOf { bar.minutes[it.id] ?: 0.0 } }
    val maximum = maxOf(1.0, ceil(totals.max()))

    if (selectedSound != null) {
        TextButton(onClick = { back() }) { Text(stringResource(R.string.history_back)) }
        Text(stringResource(R.string.history_daily, stringResource(selectedSound.title)),
            style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
    } else Row(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(true, false).forEach { value ->
            val selected = allTime == value
            Text(
                stringResource(if (value) R.string.history_all_time else R.string.history_calendar),
                modifier = Modifier.weight(1f).clip(RoundedCornerShape(8.dp))
                    .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant)
                    .selectable(selected = selected, role = Role.RadioButton, onClick = { allTime = value })
                    .heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 12.dp),
                color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.labelLarge,
                textAlign = TextAlign.Center,
            )
        }
    }
    if (!showAllTime) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = { move(-7) }) { Text("‹", modifier = Modifier.semantics { contentDescription = previousLabel }) }
            TextButton(onClick = { move(null) }) { Text(stringResource(R.string.history_today)) }
            TextButton(onClick = { move(7) }, enabled = activeOffset < 0) {
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
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                bars.forEach { bar ->
                    Text(
                        bar.label,
                        autoSize = TextAutoSize.StepBased(minFontSize = 6.sp, maxFontSize = 9.sp),
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        textAlign = TextAlign.Center,
                    )
                }
            }
            Text(stringResource(if (showAllTime) R.string.history_sound else R.string.history_date), style = MaterialTheme.typography.labelMedium, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }
    if (totals.all { it == 0.0 }) Text(stringResource(if (showAllTime) R.string.history_all_time_empty else R.string.history_empty))
    if (selectedSound == null) NoiseType.entries.forEachIndexed { index, type ->
        val actionLabel = stringResource(R.string.history_daily, labels[index])
        Row(Modifier.fillMaxWidth().testTag("history-sound-${type.id}").clip(RoundedCornerShape(8.dp))
            .clickable(role = Role.Button, onClickLabel = actionLabel) {
                selectedSoundId = type.id
                detailOffset = if (allTime) 0 else offset
                onNavigate()
            }.heightIn(min = 48.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(12.dp).background(HistoryShades[index]).border(0.5.dp, MaterialTheme.colorScheme.outline))
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.history_value, labels[index], number.format(soundTotals[type.id] ?: 0.0)),
                style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text("›", modifier = Modifier.clearAndSetSemantics {})
        }
    }
    Text(stringResource(R.string.history_local), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (failed) Text(stringResource(R.string.history_storage_failed), style = MaterialTheme.typography.bodySmall)
}
