package tv.swarmcast.p2p

import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackerStatsBufferTest {
    @Test
    fun mergesCountersKeepsFirstStartupAndLatestBuffer() {
        val buffer = TrackerStatsBuffer()
        buffer.addSample(dlP2p = 10, startupMs = 500, bufferMs = 100, iceAttempts = 1)
        buffer.addSample(dlP2p = 20, startupMs = 900, bufferMs = 200, iceAttempts = 2)
        buffer.incrementJoinTimeout()

        val json = buffer.toJson()
        assertEquals(30L, json["dl_p2p"]?.jsonPrimitive?.content?.toLong())
        assertEquals(3L, json["ice_attempts"]?.jsonPrimitive?.content?.toLong())
        assertEquals(1L, json["tracker_join_timeouts"]?.jsonPrimitive?.content?.toLong())
        assertEquals(500L, json["startup_ms"]?.jsonPrimitive?.content?.toLong())
        assertEquals(200L, json["buffer_ms"]?.jsonPrimitive?.content?.toLong())
    }

    @Test
    fun clampsNegativeDeltasAndSaturatesOverflow() {
        val buffer = TrackerStatsBuffer()
        buffer.addSample(dlP2p = Long.MAX_VALUE)
        buffer.addSample(dlP2p = 1, dlEdge = -10, iceAttempts = -1)

        val json = buffer.toJson()
        assertEquals(Long.MAX_VALUE, json["dl_p2p"]?.jsonPrimitive?.content?.toLong())
        assertEquals(0L, json["dl_edge"]?.jsonPrimitive?.content?.toLong())
        assertEquals(0L, json["ice_attempts"]?.jsonPrimitive?.content?.toLong())
    }

    @Test
    fun clearRemovesAllPendingTelemetry() {
        val buffer = TrackerStatsBuffer()
        buffer.addSample(dlP2p = 1, bufferMs = 10)
        buffer.incrementJoinTimeout()
        assertFalse(buffer.isEmpty())

        buffer.clear()

        assertTrue(buffer.isEmpty())
    }

    private fun TrackerStatsBuffer.addSample(
        dlP2p: Long = 0,
        dlEdge: Long = 0,
        startupMs: Long? = null,
        bufferMs: Long? = null,
        iceAttempts: Long = 0
    ) {
        add(
            dlP2p = dlP2p,
            dlEdge = dlEdge,
            dlBootstrapOrigin = 0,
            dlRelay = 0,
            ul = 0,
            stalls = 0,
            startupMs = startupMs,
            bufferMs = bufferMs,
            peerTimeouts = 0,
            hashFailures = 0,
            peerDisconnects = 0,
            ice = IceConnectivityDelta(attempts = iceAttempts)
        )
    }
}
