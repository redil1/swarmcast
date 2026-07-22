package tv.swarmcast.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppConfigTest {
    @Test
    fun `boolean flags accept typed manifest values`() {
        assertTrue(parseBooleanFlag(true, "flag", false))
        assertFalse(parseBooleanFlag(false, "flag", true))
    }

    @Test
    fun `boolean flags preserve string compatibility and fallback`() {
        assertTrue(parseBooleanFlag("yes", "flag", false))
        assertFalse(parseBooleanFlag("0", "flag", true))
        assertTrue(parseBooleanFlag(null, "flag", true))
    }

    @Test(expected = IllegalStateException::class)
    fun `boolean flags reject unsupported values`() {
        parseBooleanFlag(1, "flag", false)
    }
}
