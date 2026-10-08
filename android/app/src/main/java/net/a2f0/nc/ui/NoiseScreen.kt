package net.a2f0.nc.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import net.a2f0.nc.BuildConfig
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
    val lastPlayed by remember { NoisePlayer.lastPlayed(context) }.collectAsStateWithLifecycle()
    val volume by remember { NoisePlayer.volume(context) }.collectAsStateWithLifecycle()
    NoiseScreen(
        nowPlaying = nowPlaying,
        lastPlayed = lastPlayed,
        onToggle = { NoisePlayer.toggle(context, it) },
        onTogglePlayback = { NoisePlayer.togglePlayback(context) },
        volume = volume,
        onVolumeChange = { NoisePlayer.setVolume(context, it) },
    )
}

@Composable
private fun NoiseScreen(
    nowPlaying: NoiseType?,
    lastPlayed: NoiseType,
    onToggle: (NoiseType) -> Unit,
    onTogglePlayback: () -> Unit,
    volume: Float,
    onVolumeChange: (Float) -> Unit,
) {
    var sheet by rememberSaveable { mutableStateOf<Sheet?>(null) }
    Surface(
        color = MaterialTheme.colorScheme.background,
        modifier = Modifier
            .fillMaxSize()
            // Test tags are resource IDs for the Maestro flows (maestro/screenshots/).
            .semantics { testTagsAsResourceId = true },
    ) {
        Column {
            Column(
                modifier = Modifier
                    .weight(1f)
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 32.dp)
                    // Readable on tablets and in landscape, as on iOS.
                    .fillMaxWidth()
                    .wrapContentWidth()
                    .widthIn(max = 600.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    // The app icon's corners: 224 of its 1024 points. Its bottom edge sits on
                    // the title's baseline.
                    Image(
                        painterResource(R.drawable.ic_logo),
                        contentDescription = null,
                        modifier = Modifier
                            .alignBy { it.measuredHeight }
                            .size(40.dp)
                            .clip(RoundedCornerShape(9.dp)),
                    )
                    // One line, shrinking to fit narrow screens and large text sizes, as on iOS.
                    val titleStyle = MaterialTheme.typography.headlineLarge
                    Text(
                        text = stringResource(R.string.app_name),
                        style = titleStyle,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        autoSize = TextAutoSize.StepBased(minFontSize = titleStyle.fontSize / 2, maxFontSize = titleStyle.fontSize),
                        modifier = Modifier
                            .weight(1f)
                            .alignByBaseline()
                            .semantics { heading() },
                    )
                    MoreMenu(
                        onOpen = { sheet = it },
                        // The icon lines up with the cards' trailing edge; its touch target reaches past it.
                        modifier = Modifier
                            .align(Alignment.CenterVertically)
                            .offset(x = 12.dp),
                    )
                }
                Spacer(Modifier.height(8.dp))
                NoiseType.entries.forEach { type ->
                    NoiseCard(type = type, isPlaying = type == nowPlaying, onClick = { onToggle(type) })
                }
            }
            PlayerBar(
                noise = nowPlaying ?: lastPlayed,
                isPlaying = nowPlaying != null,
                onTogglePlayback = onTogglePlayback,
                volume = volume,
                onVolumeChange = onVolumeChange,
            )
        }
    }
    sheet?.let { open ->
        SheetContent(open, onDismiss = { sheet = null }) {
            when (open) {
                Sheet.SETTINGS -> SettingsContent(volume = volume, onVolumeChange = onVolumeChange)
                Sheet.ABOUT -> AboutContent()
            }
        }
    }
}

/** The sheets the menu opens. */
private enum class Sheet(@StringRes val title: Int) {
    SETTINGS(R.string.settings),
    ABOUT(R.string.about),
}

/** The three-dot menu at the end of the title: Settings, Rate App, and About. */
@Composable
private fun MoreMenu(onOpen: (Sheet) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        IconButton(onClick = { expanded = true }) {
            Icon(
                painterResource(R.drawable.ic_more_vert),
                contentDescription = stringResource(R.string.more),
                tint = MaterialTheme.colorScheme.onSurface,
            )
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.settings)) },
                onClick = {
                    expanded = false
                    onOpen(Sheet.SETTINGS)
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.rate_app)) },
                onClick = {
                    expanded = false
                    openStoreListing(context)
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.about)) },
                onClick = {
                    expanded = false
                    onOpen(Sheet.ABOUT)
                },
            )
        }
    }
}

/** Opens the app's Google Play page: in the Play Store app, or else in a browser. */
private fun openStoreListing(context: Context) {
    val page = "details?id=${context.packageName}"
    for (uri in listOf("market://$page", "https://play.google.com/store/apps/$page")) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri.toUri()))
            return
        } catch (_: ActivityNotFoundException) {
            // Try the next one.
        }
    }
}

/** A bottom sheet with a title. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SheetContent(sheet: Sheet, onDismiss: () -> Unit, content: @Composable () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, bottom = 24.dp)
                // The sheet is its own window, outside the screen's semantics.
                .semantics { testTagsAsResourceId = true },
        ) {
            Text(
                stringResource(sheet.title),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.semantics { heading() },
            )
            content()
        }
    }
}

/** Settings: for now, the volume. */
@Composable
private fun SettingsContent(volume: Float, onVolumeChange: (Float) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // The slider reads its own label.
        Text(
            stringResource(R.string.volume),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.clearAndSetSemantics {},
        )
        VolumeSlider(volume = volume, onVolumeChange = onVolumeChange, modifier = Modifier.testTag("settings-volume"))
    }
}

/** The app's name, version, and build. */
@Composable
private fun AboutContent() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        // The app icon's corners, as beside the title.
        Image(
            painterResource(R.drawable.ic_logo),
            contentDescription = null,
            modifier = Modifier
                .size(64.dp)
                .clip(RoundedCornerShape(14.dp)),
        )
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleMedium)
            Text(
                stringResource(R.string.about_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE.toString()),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Pinned to the bottom of the screen: stops the noise, or plays the last one again, and
 * sets the volume.
 */
@Composable
private fun PlayerBar(
    noise: NoiseType,
    isPlaying: Boolean,
    onTogglePlayback: () -> Unit,
    volume: Float,
    onVolumeChange: (Float) -> Unit,
) {
    val description = buttonDescription(noise, isPlaying)
    Column {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                .padding(horizontal = 24.dp, vertical = 12.dp)
                .fillMaxWidth()
                .wrapContentWidth()
                .widthIn(max = 600.dp),
        ) {
            PlaybackSymbol(
                isPlaying = isPlaying,
                onClick = onTogglePlayback,
                modifier = Modifier
                    .testTag("playback")
                    .semantics { contentDescription = description },
            )
            VolumeSlider(volume = volume, onVolumeChange = onVolumeChange, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun VolumeSlider(volume: Float, onVolumeChange: (Float) -> Unit, modifier: Modifier = Modifier) {
    val description = stringResource(R.string.volume)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = modifier.padding(horizontal = 4.dp),
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
    val description = buttonDescription(type, isPlaying)
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(
            width = if (isPlaying) 2.dp else 1.dp,
            color = if (isPlaying) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outlineVariant,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = description },
    ) {
        Row(
            modifier = Modifier
                .padding(20.dp)
                .clearAndSetSemantics {},
            verticalAlignment = Alignment.CenterVertically,
        ) {
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
            PlaybackSymbol(isPlaying = isPlaying)
        }
    }
}

/** A play or stop symbol in a circle, filled while playing; a button when it has [onClick]. */
@Composable
private fun PlaybackSymbol(isPlaying: Boolean, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    val color = if (isPlaying) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.surfaceVariant
    val icon: @Composable () -> Unit = {
        Icon(
            painterResource(if (isPlaying) R.drawable.ic_stop else R.drawable.ic_play),
            contentDescription = null,
            tint = if (isPlaying) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.wrapContentSize(Alignment.Center),
        )
    }
    if (onClick == null) {
        Surface(shape = CircleShape, color = color, modifier = modifier.size(48.dp), content = icon)
    } else {
        Surface(onClick = onClick, shape = CircleShape, color = color, modifier = modifier.size(48.dp), content = icon)
    }
}

/** Read as a play or stop button's action, as on iOS. */
@Composable
private fun buttonDescription(type: NoiseType, isPlaying: Boolean): String =
    stringResource(if (isPlaying) R.string.stop_noise else R.string.play_noise, stringResource(type.title))

@Preview(showBackground = true)
@Composable
private fun NoiseScreenPreview() {
    NoiseConnoisseurTheme {
        NoiseScreen(
            nowPlaying = NoiseType.PINK,
            lastPlayed = NoiseType.PINK,
            onToggle = {},
            onTogglePlayback = {},
            volume = 0.7f,
            onVolumeChange = {},
        )
    }
}
