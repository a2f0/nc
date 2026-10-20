package net.a2f0.nc.ui

import android.content.Context
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class AppearanceTest {
    @Test fun newReadersRestoreEachStablePreference() {
        val context = RuntimeEnvironment.getApplication()
        val disk = context.getSharedPreferences("appearance-test", Context.MODE_PRIVATE)
        disk.edit().clear().commit()
        assertEquals(Appearance.SYSTEM, AppearancePreferences(disk).appearance)
        for (value in listOf(Appearance.DARK, Appearance.LIGHT, Appearance.SYSTEM)) {
            AppearancePreferences(disk).select(value)
            assertEquals(value.id, disk.getString("appearance", null))
            assertEquals(value, AppearancePreferences(disk).appearance)
        }
    }

    @Test fun explicitChoicesOverrideSystemAndUnknownChoicesFollowIt() {
        for (systemDark in listOf(false, true)) {
            assertEquals(systemDark, Appearance.SYSTEM.isDark(systemDark))
            assertFalse(Appearance.LIGHT.isDark(systemDark))
            assertTrue(Appearance.DARK.isDark(systemDark))
        }
        assertEquals(Appearance.SYSTEM, Appearance.fromId(null))
        assertEquals(Appearance.SYSTEM, Appearance.fromId("future-mode"))
        assertEquals(Appearance.SYSTEM, Appearance.fromId("DARK"))
    }
}
