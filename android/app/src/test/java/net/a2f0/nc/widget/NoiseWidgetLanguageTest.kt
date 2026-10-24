package net.a2f0.nc.widget

import android.content.Context
import android.os.Parcel
import android.widget.RemoteViews
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.ExperimentalGlanceApi
import androidx.glance.appwidget.runComposition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import net.a2f0.nc.Language
import net.a2f0.nc.LanguagePreferences
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class NoiseWidgetLanguageTest {
    @OptIn(ExperimentalGlanceApi::class)
    @Test
    fun relabelsAnAlreadyRunningCompositionWithoutChangingPlayback() = runBlocking {
        val context = RuntimeEnvironment.getApplication() as Context
        LanguagePreferences.select(context, Language.EN)
        val views = Channel<RemoteViews>(Channel.UNLIMITED)
        val session = launch(Dispatchers.Default) {
            NoiseWidget().runComposition(context, sizes = listOf(DpSize(300.dp, 300.dp)))
                .collect { views.send(it) }
        }
        try {
            suspend fun awaitLabel(label: String) = withTimeout(15_000) {
                while (true) {
                    val parcel = Parcel.obtain()
                    val text = try {
                        views.receive().writeToParcel(parcel, 0)
                        val bytes = parcel.marshall()
                        // Android parcels use UTF-16; Robolectric's serializer also uses UTF-8.
                        String(bytes, Charsets.UTF_16LE) + String(bytes, Charsets.UTF_8)
                    } finally {
                        parcel.recycle()
                    }
                    if (text.contains(label)) break
                }
                true
            }
            assertTrue(awaitLabel("White"))
            LanguagePreferences.select(context, Language.DE)
            assertTrue(awaitLabel("Weiß"))
            LanguagePreferences.select(context, Language.ES)
            assertTrue(awaitLabel("Blanco"))
        } finally {
            session.cancelAndJoin()
            views.close()
        }
    }
}
