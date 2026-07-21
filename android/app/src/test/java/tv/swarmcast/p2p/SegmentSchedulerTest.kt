package tv.swarmcast.p2p

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.security.MessageDigest

class SegmentSchedulerTest {
    @Test
    fun attributesPeerDeliveryWithoutCountingRelayBytesAsDirectP2p() {
        assertEquals(PeerDownloadAttribution(1_000, 0), peerDownloadAttribution(1_000, 4, 0))
        assertEquals(PeerDownloadAttribution(0, 1_000), peerDownloadAttribution(1_000, 0, 4))
        assertEquals(PeerDownloadAttribution(750, 250), peerDownloadAttribution(1_000, 3, 1))
        assertEquals(PeerDownloadAttribution(0, 1_000), peerDownloadAttribution(1_000, 0, 0))
    }

    @Test
    fun designatedSuperPeerBootstrapsFromOriginAndAccountsBytes() = withServer { server ->
        val bytes = "origin-segment".toByteArray()
        server.enqueue(MockResponse().setResponseCode(200).setBody(bytes.toString(Charsets.ISO_8859_1)))
        val scheduler = scheduler(server, superPeer = true)
        scheduler.onSegmentAnnounce(segment(bytes, seedTier = true))

        val result = runBlocking { scheduler.fetchSegment(7, "seg-7.m4s", 1_500) }

        assertArrayEquals(bytes, result)
        assertEquals("/origin/seg-7.m4s?token=test-token", server.takeRequest().path)
        assertEquals(bytes.size.toLong(), scheduler.stats().downloadedFromBootstrapOrigin)
        assertEquals(0L, scheduler.stats().downloadedFromEdge)
    }

    @Test
    fun designatedSuperPeerBootstrapsFromOwnedEdgeWithoutOriginPermission() = withServer { server ->
        val bytes = "edge-bootstrap-segment".toByteArray()
        server.enqueue(MockResponse().setResponseCode(200).setBody(bytes.toString(Charsets.ISO_8859_1)))
        val scheduler = scheduler(server, superPeer = true)
        scheduler.onSegmentAnnounce(segment(bytes, seedTier = false, edgeSeedTier = true))

        val result = runBlocking { scheduler.fetchSegment(7, "seg-7.m4s", 1_500) }

        assertArrayEquals(bytes, result)
        assertEquals("/edge/seg-7.m4s?token=test-token", server.takeRequest().path)
        assertEquals(0L, scheduler.stats().downloadedFromBootstrapOrigin)
        assertEquals(bytes.size.toLong(), scheduler.stats().downloadedFromEdge)
    }

    @Test
    fun nonSeedNeverUsesOriginAndFallsBackToEdge() = withServer { server ->
        val bytes = "edge-segment".toByteArray()
        server.enqueue(MockResponse().setResponseCode(200).setBody(bytes.toString(Charsets.ISO_8859_1)))
        val scheduler = scheduler(server, superPeer = false)
        scheduler.onSegmentAnnounce(segment(bytes, seedTier = true))

        val result = runBlocking { scheduler.fetchSegment(7, "seg-7.m4s", 250) }

        assertArrayEquals(bytes, result)
        assertEquals("/edge/seg-7.m4s?token=test-token", server.takeRequest().path)
        assertEquals(0L, scheduler.stats().downloadedFromBootstrapOrigin)
        assertEquals(bytes.size.toLong(), scheduler.stats().downloadedFromEdge)
    }

    @Test
    fun failedOriginBootstrapFallsBackToEdgeAndPreservesAccounting() = withServer { server ->
        val bytes = "fallback-segment".toByteArray()
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setResponseCode(200).setBody(bytes.toString(Charsets.ISO_8859_1)))
        val scheduler = scheduler(server, superPeer = true)
        scheduler.onSegmentAnnounce(segment(bytes, seedTier = true))

        val result = runBlocking { scheduler.fetchSegment(7, "seg-7.m4s", 1_500) }

        assertArrayEquals(bytes, result)
        assertEquals("/origin/seg-7.m4s?token=test-token", server.takeRequest().path)
        assertEquals("/edge/seg-7.m4s?token=test-token", server.takeRequest().path)
        assertEquals(0L, scheduler.stats().downloadedFromBootstrapOrigin)
        assertEquals(bytes.size.toLong(), scheduler.stats().downloadedFromEdge)
    }

    @Test
    fun edgeHashMismatchIsNeverReturnedOrStored() = withServer { server ->
        val expected = "expected".toByteArray()
        server.enqueue(MockResponse().setResponseCode(200).setBody("poisoned"))
        val store = SegmentStore()
        val scheduler = scheduler(server, superPeer = false, store = store)
        scheduler.onSegmentAnnounce(segment(expected, seedTier = false))

        assertThrows(IllegalStateException::class.java) {
            runBlocking { scheduler.fetchSegment(7, "seg-7.m4s", 250) }
        }
        assertEquals(null, store.get(7))
    }

    @Test
    fun missingManifestNeverFetchesUnverifiedOwnedBytes() = withServer { server ->
        val scheduler = scheduler(server, superPeer = false)

        assertThrows(IllegalStateException::class.java) {
            runBlocking { scheduler.fetchSegment(7, "seg-7.m4s", 250) }
        }
        assertEquals(0, server.requestCount)
    }

    private fun scheduler(
        server: MockWebServer,
        superPeer: Boolean,
        store: SegmentStore = SegmentStore()
    ): SegmentScheduler {
        return SegmentScheduler(store).also { scheduler ->
            scheduler.configure(
                TrackerEvent.Joined(
                    peerId = "peer",
                    playlistUrl = server.url("/playlist.m3u8").toString(),
                    edgeTemplate = "${server.url("/")}edge/{file}",
                    originTemplate = "${server.url("/")}origin/{file}",
                    swarmMode = "p2p",
                    superPeer = superPeer
                ),
                token = "test-token"
            )
        }
    }

    private fun segment(bytes: ByteArray, seedTier: Boolean, edgeSeedTier: Boolean = false) = TrackerEvent.Segment(
        seq = 7,
        sha256 = sha256(bytes),
        size = bytes.size.toLong(),
        k = 4,
        seedTier = seedTier,
        edgeSeedTier = edgeSeedTier
    )

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }

    private fun withServer(block: (MockWebServer) -> Unit) {
        val server = MockWebServer()
        server.start()
        try {
            block(server)
        } finally {
            server.shutdown()
        }
    }
}
