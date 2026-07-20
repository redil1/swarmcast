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

class TrackerClientTest {
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
