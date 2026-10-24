package net.a2f0.nc.ui

import android.content.res.Resources
import android.text.format.DateFormat
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import net.a2f0.nc.NoiseType
import net.a2f0.nc.R
import net.a2f0.nc.history.HistoryDay
import net.a2f0.nc.history.ListeningHistory
import net.a2f0.nc.history.historyDays
import net.a2f0.nc.history.historyTotals
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.ceil

/** One bar of the chart: its axis label, its screen reader description, and each sound's minutes. */
private data class HistoryBar(val label: String, val description: String, val minutes: Map<String, Double>) {
    val total = NoiseType.entries.sumOf { minutes[it.id] ?: 0.0 }
}

private val ChartHeight = 180.dp

/** The minutes axis is divided into this many steps, from zero to the chart's maximum. */
private const val CHART_STEPS = 4

/** The days a week's arrows move by. */
private const val WEEK_DAYS = 7

/** The number and date formats for [locale]. */
private class HistoryFormats(locale: Locale) {
    val number: NumberFormat = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1 }
    val date: DateTimeFormatter = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
    val shortDate: DateTimeFormatter =
        DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, "Md"), locale)
}

/** A week's days, or none for all time; each sound's minutes in them; and the chart's bars. */
private class HistoryPage(val days: List<HistoryDay>, val totals: Map<String, Double>, val bars: List<HistoryBar>)

@Composable
fun HistoryContent(onNavigate: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val locale = LocalConfiguration.current.locales[0]
    val history = remember { ListeningHistory.get(context) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val updates = remember(history, lifecycle) { historyUpdates(history, lifecycle) }
    val initial = remember(history) { HistoryUpdate(history.snapshot(), System.currentTimeMillis()) }
    val update by updates.collectAsState(initial = initial)
    val failed by history.storageFailed.collectAsStateWithLifecycle(minActiveState = Lifecycle.State.RESUMED)
    var allTime by rememberSaveable { mutableStateOf(false) }
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var selectedSoundId by rememberSaveable { mutableStateOf<String?>(null) }
    var detailOffset by rememberSaveable { mutableIntStateOf(0) }
    val selectedSound = NoiseType.fromId(selectedSoundId)
    val showAllTime = allTime && selectedSound == null
    val activeOffset = if (selectedSound == null) offset else detailOffset
    fun move(days: Int?) {
        val moved = days?.let { minOf(0, activeOffset + it) } ?: 0
        if (selectedSound == null) offset = moved else detailOffset = moved
    }
    fun back() {
        selectedSoundId = null
        onNavigate()
    }
    BackHandler(enabled = selectedSound != null) { back() }
    val formats = remember(locale) { HistoryFormats(locale) }
    val page = rememberHistoryPage(update, selectedSound, showAllTime, activeOffset, formats)

    Column(modifier, verticalArrangement = Arrangement.spacedBy(SheetSpacing)) {
        HistoryHeader(selectedSound, allTime, onBack = ::back, onSelectView = { allTime = it })
        if (!showAllTime) {
            WeekNavigation(canMoveForward = activeOffset < 0, onMove = ::move)
            Text(
                "${formats.date.format(page.days.first().date)} – ${formats.date.format(page.days.last().date)}",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        HistoryChart(
            page.bars,
            formats.number,
            stringResource(if (showAllTime) R.string.history_sound else R.string.history_date),
        )
        if (page.bars.all { it.total == 0.0 }) {
            Text(stringResource(if (showAllTime) R.string.history_all_time_empty else R.string.history_empty))
        }
        if (selectedSound == null) {
            HistoryLegend(page.totals, formats.number, onSelect = { type ->
                selectedSoundId = type.id
                detailOffset = if (allTime) 0 else offset
                onNavigate()
            })
        }
        HistoryFooter(storageFailed = failed)
    }
}

/** Where history is kept, and whether keeping it failed. */
@Composable
private fun HistoryFooter(storageFailed: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(SheetSpacing)) {
        Text(
            stringResource(R.string.history_local),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (storageFailed) {
            Text(stringResource(R.string.history_storage_failed), style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** [selectedSound]'s history, or every sound's, all time or for the week ending [offset] days from today. */
@Composable
private fun rememberHistoryPage(
    update: HistoryUpdate,
    selectedSound: NoiseType?,
    allTime: Boolean,
    offset: Int,
    formats: HistoryFormats,
): HistoryPage {
    val resources = LocalResources.current
    val sessions = remember(update.sessions, selectedSound) {
        update.sessions.filter { selectedSound == null || it.soundId == selectedSound.id }
    }
    val zone = ZoneId.systemDefault()
    val endDay = Instant.ofEpochMilli(update.refreshedAt).atZone(zone).toLocalDate().plusDays(offset.toLong())
    val days = remember(sessions, endDay, zone, allTime) {
        if (allTime) emptyList() else historyDays(sessions, endDay, zone)
    }
    val totals = remember(sessions, days, allTime) {
        if (allTime) {
            historyTotals(sessions)
        } else {
            NoiseType.entries.associate { type -> type.id to days.sumOf { it.minutes[type.id] ?: 0.0 } }
        }
    }
    val sounds = selectedSound?.let { listOf(it) } ?: NoiseType.entries
    val bars = if (allTime) allTimeBars(resources, totals, formats) else dayBars(resources, days, sounds, formats)
    return HistoryPage(days, totals, bars)
}

/** A bar for each sound's total. */
private fun allTimeBars(resources: Resources, totals: Map<String, Double>, formats: HistoryFormats): List<HistoryBar> =
    NoiseType.entries.map { type ->
        val minutes = totals[type.id] ?: 0.0
        val value = formats.number.format(minutes)
        HistoryBar(
            resources.getString(type.shortTitle),
            resources.getString(R.string.history_value, resources.getString(type.title), value),
            mapOf(type.id to minutes),
        )
    }

/** A bar for each day, described by its date and each of [sounds]' minutes. */
private fun dayBars(
    resources: Resources,
    days: List<HistoryDay>,
    sounds: List<NoiseType>,
    formats: HistoryFormats,
): List<HistoryBar> = days.map { day ->
    val minutes = sounds.joinToString("; ") { type ->
        val value = formats.number.format(day.minutes[type.id] ?: 0.0)
        resources.getString(R.string.history_value, resources.getString(type.title), value)
    }
    HistoryBar(formats.shortDate.format(day.date), formats.date.format(day.date) + ". " + minutes, day.minutes)
}

/** Back to every sound and the selected sound's name, or the view tabs. */
@Composable
private fun HistoryHeader(
    selectedSound: NoiseType?,
    allTime: Boolean,
    onBack: () -> Unit,
    onSelectView: (Boolean) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(SheetSpacing)) {
        if (selectedSound != null) {
            TextButton(onClick = onBack) { Text(stringResource(R.string.history_back)) }
            Text(
                stringResource(R.string.history_daily, stringResource(selectedSound.title)),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { heading() },
            )
        } else {
            HistoryViewTabs(allTime = allTime, onSelect = onSelectView)
        }
    }
}

/** All time or calendar weeks. */
@Composable
private fun HistoryViewTabs(allTime: Boolean, onSelect: (Boolean) -> Unit) {
    val colors = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(true, false).forEach { value ->
            val selected = allTime == value
            Text(
                stringResource(if (value) R.string.history_all_time else R.string.history_calendar),
                modifier = Modifier.weight(1f).clip(RoundedCornerShape(8.dp))
                    .background(if (selected) colors.primary else colors.surfaceVariant)
                    .selectable(selected = selected, role = Role.RadioButton, onClick = { onSelect(value) })
                    .heightIn(min = 48.dp).padding(horizontal = 12.dp, vertical = 12.dp),
                color = if (selected) colors.onPrimary else colors.onSurfaceVariant,
                style = MaterialTheme.typography.labelLarge,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** The previous week, this week, and the next, unless that's in the future. Null moves to today. */
@Composable
private fun WeekNavigation(canMoveForward: Boolean, onMove: (Int?) -> Unit) {
    val previousLabel = stringResource(R.string.history_previous)
    val nextLabel = stringResource(R.string.history_next)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        TextButton(onClick = { onMove(-WEEK_DAYS) }) {
            Text("‹", modifier = Modifier.semantics { contentDescription = previousLabel })
        }
        TextButton(onClick = { onMove(null) }) { Text(stringResource(R.string.history_today)) }
        TextButton(onClick = { onMove(WEEK_DAYS) }, enabled = canMoveForward) {
            Text("›", modifier = Modifier.semantics { contentDescription = nextLabel })
        }
    }
}

/** Each bar's minutes stacked by sound, in the legend's shades, with a minutes axis and the bars' labels. */
@Composable
private fun HistoryChart(bars: List<HistoryBar>, number: NumberFormat, axisLabel: String) {
    val maximum = maxOf(1.0, ceil(bars.maxOf { it.total }))
    Column(verticalArrangement = Arrangement.spacedBy(SheetSpacing)) {
        Text(stringResource(R.string.history_minutes), style = MaterialTheme.typography.labelMedium)
        Row(Modifier.fillMaxWidth()) {
            Column(
                Modifier.height(ChartHeight).padding(end = 6.dp),
                verticalArrangement = Arrangement.SpaceBetween,
                horizontalAlignment = Alignment.End,
            ) {
                for (step in CHART_STEPS downTo 0) Text(number.format(maximum * step / CHART_STEPS), fontSize = 10.sp)
            }
            Column(Modifier.weight(1f)) {
                Box(Modifier.fillMaxWidth().height(ChartHeight)) {
                    Column(Modifier.matchParentSize(), verticalArrangement = Arrangement.SpaceBetween) {
                        repeat(CHART_STEPS + 1) {
                            Box(
                                Modifier.fillMaxWidth().height(
                                    0.5.dp,
                                ).background(MaterialTheme.colorScheme.outlineVariant),
                            )
                        }
                    }
                    Row(Modifier.matchParentSize(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        bars.forEach { bar -> StackedBar(bar, maximum) }
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
                Text(
                    axisLabel,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                )
            }
        }
    }
}

@Composable
private fun RowScope.StackedBar(bar: HistoryBar, maximum: Double) {
    Column(
        Modifier.weight(1f).height(ChartHeight).semantics { contentDescription = bar.description },
        verticalArrangement = Arrangement.Bottom,
    ) {
        NoiseType.entries.withIndex().reversed().forEach { (index, type) ->
            val minutes = bar.minutes[type.id] ?: 0.0
            if (minutes > 0) {
                Box(
                    Modifier.fillMaxWidth().height((ChartHeight.value * minutes / maximum).dp)
                        .background(HistoryShades[index]).border(0.5.dp, MaterialTheme.colorScheme.outline),
                )
            }
        }
    }
}

/** Each sound's total, in its shade in the chart, opening that sound's daily history. */
@Composable
private fun HistoryLegend(totals: Map<String, Double>, number: NumberFormat, onSelect: (NoiseType) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(SheetSpacing)) {
        NoiseType.entries.forEachIndexed { index, type ->
            val label = stringResource(type.title)
            Row(
                Modifier.fillMaxWidth().testTag("history-sound-${type.id}").clip(RoundedCornerShape(8.dp))
                    .clickable(role = Role.Button, onClickLabel = stringResource(R.string.history_daily, label)) {
                        onSelect(type)
                    }.heightIn(min = 48.dp).padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(
                        12.dp,
                    ).background(HistoryShades[index]).border(0.5.dp, MaterialTheme.colorScheme.outline),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    stringResource(R.string.history_value, label, number.format(totals[type.id] ?: 0.0)),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
                Text("›", modifier = Modifier.clearAndSetSemantics {})
            }
        }
    }
}
