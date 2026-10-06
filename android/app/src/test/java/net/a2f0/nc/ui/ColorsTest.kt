package net.a2f0.nc.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ColorsTest {
    // Every color role, found by reflection so roles added to Material later are checked too.
    private fun roles(scheme: ColorScheme): Map<String, Color> =
        ColorScheme::class.java.methods
            .filter { it.name.startsWith("get") && it.returnType == Long::class.javaPrimitiveType && it.parameterCount == 0 }
            .associate { it.name.removePrefix("get").substringBefore('-') to Color((it.invoke(scheme) as Long).toULong()) }

    @Test
    fun everyRoleIsGray() {
        for ((name, scheme) in mapOf("light" to LightColors, "dark" to DarkColors)) {
            val roles = roles(scheme)
            assertTrue("$name: found only ${roles.size} roles", roles.size >= 48)
            for ((role, color) in roles) {
                assertEquals("$name $role green", color.red, color.green, 0f)
                assertEquals("$name $role blue", color.red, color.blue, 0f)
            }
        }
    }

    @Test
    fun graysStayTheSame() {
        for (gray in listOf(Color.Black, Color(0xFF1C1C1C), Color(0xFF6C6C6C), Color(0xFFF2F2F2), Color.White)) {
            assertEquals(gray, gray.toGray())
        }
    }

    @Test
    fun colorsBecomeGraysOfTheSameLuma() {
        val gray = Color(0xFF6750A4).toGray() // Material's baseline purple
        assertEquals(gray.red, gray.green, 0f)
        assertEquals(gray.red, gray.blue, 0f)
        assertEquals(0.2126f * 0x67 / 255 + 0.7152f * 0x50 / 255 + 0.0722f * 0xA4 / 255, gray.red, 0.002f)
    }
}
