package tv.swarmcast.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkPolicyTest {
    @Test
    fun cellularCanDownloadWithoutUpload() {
        val permissions = p2pPermissions(
            enabled = true,
            snapshot = snapshot(uploadAllowed = false, p2pDownloadAllowed = true)
        )

        assertTrue(permissions.downloadAllowed)
        assertFalse(permissions.uploadAllowed)
    }

    @Test
    fun productToggleDisablesBothDirections() {
        val permissions = p2pPermissions(
            enabled = false,
            snapshot = snapshot(uploadAllowed = true, p2pDownloadAllowed = true)
        )

        assertFalse(permissions.downloadAllowed)
        assertFalse(permissions.uploadAllowed)
    }

    private fun snapshot(uploadAllowed: Boolean, p2pDownloadAllowed: Boolean) = NetworkPolicySnapshot(
        transport = "cellular",
        metered = true,
        batteryPercent = 80,
        charging = false,
        uplinkKbps = 0,
        uploadAllowed = uploadAllowed,
        p2pDownloadAllowed = p2pDownloadAllowed
    )
}
