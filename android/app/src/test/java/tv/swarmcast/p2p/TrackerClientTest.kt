package tv.swarmcast.p2p

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class TrackerClientTest {
    @Test
    fun reportsNetworkClassAndIceTelemetry() {
        val server = MockWebServer()
        val joined = CountDownLatch(1)
        val statsReceived = CountDownLatch(1)
        val joinMessage = AtomicReference<String>()
        val statsMessage = AtomicReference<String>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                when {
                    text.contains("\"t\":\"join\"") -> {
                        joinMessage.set(text)
                        joined.countDown()
                    }
                    text.contains("\"t\":\"stats\"") -> {
                        statsMessage.set(text)
                        statsReceived.countDown()
                    }
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }
        }))
        server.start()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val client = TrackerClient(
            initialWsUrl = server.url("/ws").toString().replaceFirst("http", "ws").removeSuffix("/"),
            tokenProvider = { "token" },
            scope = scope
        )

        try {
            client.connect("demo", wifi = false, uploadEnabled = false, networkClass = "cellular")
            assertTrue(joined.await(3, TimeUnit.SECONDS))
            client.reportStats(
                dlP2p = 0,
                dlEdge = 0,
                ul = 0,
                ice = IceConnectivityDelta(attempts = 2, successes = 1, failures = 1, srflxSuccesses = 1)
            )
            assertTrue(statsReceived.await(3, TimeUnit.SECONDS))
            assertTrue(joinMessage.get().contains("\"transport\":\"cellular\""))
            assertTrue(statsMessage.get().contains("\"ice_attempts\":2"))
            assertTrue(statsMessage.get().contains("\"ice_candidate_srflx\":1"))
        } finally {
            client.close()
            scope.cancel()
            server.shutdown()
        }
    }

    @Test
    fun reconnectsAndRejoinsAfterSocketFailure() {
        val server = MockWebServer()
        val joins = CountDownLatch(2)
        val assignmentKeys = CopyOnWriteArrayList<String>()
        val connection = AtomicInteger()
        val listener = object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!text.contains("\"t\":\"join\"")) return
                Regex("\"assignmentKey\":\"([^\"]+)\"").find(text)?.groupValues?.get(1)?.let(assignmentKeys::add)
                joins.countDown()
                if (connection.getAndIncrement() == 0) webSocket.close(1011, "forced failure")
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }
        }
        server.enqueue(MockResponse().withWebSocketUpgrade(listener))
        server.enqueue(MockResponse().withWebSocketUpgrade(listener))
        server.start()

        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val tokenCalls = AtomicInteger()
        val wsUrl = server.url("/ws").toString().replaceFirst("http", "ws").removeSuffix("/")
        val client = TrackerClient(
            initialWsUrl = wsUrl,
            tokenProvider = { "token-${tokenCalls.incrementAndGet()}" },
            scope = scope
        )

        try {
            client.connect("demo", wifi = false, uploadEnabled = false)
            assertTrue("tracker did not reconnect", joins.await(8, TimeUnit.SECONDS))
            assertEquals("/ws?token=token-1", server.takeRequest(1, TimeUnit.SECONDS)?.path)
            assertEquals("/ws?token=token-2", server.takeRequest(1, TimeUnit.SECONDS)?.path)
            assertEquals(2, tokenCalls.get())
            assertEquals(2, assignmentKeys.size)
            assertEquals(assignmentKeys[0], assignmentKeys[1])
        } finally {
            client.close()
            scope.cancel()
            server.shutdown()
        }
    }
}
