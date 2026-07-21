package tv.swarmcast.diagnostics

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.swarmcast.data.NetworkPolicySnapshot
import tv.swarmcast.p2p.IceConnectivityDelta
import tv.swarmcast.p2p.SchedulerStats
import java.util.Base64

class DeviceLabDiagnosticsTest {
    @Test
    fun snapshotWireFormatContainsOnlySanitizedOperationalFields() {
        val snapshot = sampleSnapshot()
        val wire = snapshot.toWireValue()
        val json = String(
            Base64.getUrlDecoder().decode(wire.removePrefix(DeviceLabSnapshot.WIRE_PREFIX)),
            Charsets.UTF_8
        )
        val parsed = Json.parseToJsonElement(json).jsonObject

        assertTrue(wire.startsWith("scdl1:"))
        assertEquals("demo", parsed["channelId"]?.jsonPrimitive?.content)
        assertEquals("cellular", parsed["networkClass"]?.jsonPrimitive?.content)
        assertEquals("1000", parsed["downloadedFromPeers"]?.jsonPrimitive?.content)
        assertEquals("1", parsed["iceCandidateRelay"]?.jsonPrimitive?.content)
        for (forbidden in listOf("token", "url", "peerId", "carrier", "ssid", "bssid", "deviceId")) {
            assertFalse(json.contains(forbidden, ignoreCase = true))
        }
    }

    @Test
    fun registryRejectsStaleOwnerUnregisterAndControlsActiveSession() {
        val owner = Any()
        var enabled = true
        DeviceLabDiagnostics.register(owner, ::sampleSnapshot) { enabled = it }

        DeviceLabDiagnostics.unregister(Any())
        assertEquals("demo", DeviceLabDiagnostics.snapshot()?.channelId)
        assertEquals("demo", DeviceLabDiagnostics.setP2pEnabled(false)?.channelId)
        assertFalse(enabled)

        DeviceLabDiagnostics.unregister(owner)
        assertNull(DeviceLabDiagnostics.snapshot())
    }

    private fun sampleSnapshot() = DeviceLabSnapshot(
        capturedAtElapsedRealtimeMs = 1234,
        channelId = "demo",
        p2pEnabled = true,
        p2pDownloadAllowed = true,
        uploadAllowed = false,
        swarmMode = "p2p",
        network = NetworkPolicySnapshot(
            transport = "cellular",
            metered = true,
            batteryPercent = 70,
            charging = false,
            uplinkKbps = 0,
            uploadAllowed = false,
            p2pDownloadAllowed = true
        ),
        activePeerLinks = 2,
        playbackStarted = true,
        rebufferCount = 0,
        bufferMs = 20_000,
        scheduler = SchedulerStats(
            downloadedFromPeers = 1_000,
            downloadedFromEdge = 100,
            downloadedFromRelay = 20,
            uploadedToPeers = 0,
            activePeerLinks = 2
        ),
        ice = IceConnectivityDelta(attempts = 2, successes = 1, failures = 1, relaySuccesses = 1)
    )
}
