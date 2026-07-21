package tv.swarmcast.p2p

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

class TrackerClientTest {
    @Test
    fun rejectsNonPositiveJoinAcknowledgementTimeout() {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        try {
            assertThrows(IllegalArgumentException::class.java) {
                TrackerClient(
                    initialWsUrl = "ws://tracker.example.test/ws",
                    tokenProvider = { "token" },
                    scope = scope,
                    joinAckTimeoutMs = 0L
                )
            }
        } finally {
            scope.cancel()
        }
    }

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
                        webSocket.send(
                            """{"t":"joined","peerId":"peer-1","cellId":"cell-a","playlistUrl":"https://edge.example.tv/live/demo/index.m3u8","edgeUrlTemplate":"https://edge.example.tv/live/demo/{seq}.m4s","originUrlTemplate":"https://origin.example.tv/live/demo/{seq}.m4s","swarmMode":"p2p","superPeer":false}"""
                        )
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
    fun buffersAndMergesStatsUntilTheTrackerJoinIsAcknowledged() {
        val server = MockWebServer()
        val joinReceived = CountDownLatch(1)
        val firstStatsReceived = CountDownLatch(1)
        val secondStatsReceived = CountDownLatch(1)
        val serverSocket = AtomicReference<WebSocket>()
        val statsMessages = CopyOnWriteArrayList<String>()
        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                when {
                    text.contains("\"t\":\"join\"") -> {
                        serverSocket.set(webSocket)
                        joinReceived.countDown()
                    }
                    text.contains("\"t\":\"stats\"") -> {
                        statsMessages.add(text)
                        if (statsMessages.size == 1) firstStatsReceived.countDown() else secondStatsReceived.countDown()
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
            client.connect("demo", wifi = true, uploadEnabled = true)
            assertTrue(joinReceived.await(3, TimeUnit.SECONDS))
            client.reportStats(
                dlP2p = 10,
                dlEdge = 20,
                ul = 5,
                startupMs = 500,
                bufferMs = 100,
                ice = IceConnectivityDelta(attempts = 1, failures = 1)
            )
            client.reportStats(
                dlP2p = 20,
                dlEdge = 30,
                ul = 7,
                startupMs = 600,
                bufferMs = 200,
                ice = IceConnectivityDelta(attempts = 2, successes = 2, srflxSuccesses = 2)
            )
            Thread.sleep(200L)
            assertEquals(0, statsMessages.size)

            serverSocket.get().send(
                """{"t":"joined","peerId":"peer-1","cellId":"cell-a","playlistUrl":"https://edge.example.tv/live/demo/index.m3u8","edgeUrlTemplate":"https://edge.example.tv/live/demo/{seq}.m4s","originUrlTemplate":"https://origin.example.tv/live/demo/{seq}.m4s","swarmMode":"p2p","superPeer":false}"""
            )
            assertTrue(firstStatsReceived.await(3, TimeUnit.SECONDS))
            client.reportStats(dlP2p = 5, dlEdge = 0, ul = 0, bufferMs = 300)
            assertTrue(secondStatsReceived.await(3, TimeUnit.SECONDS))

            val first = Json.parseToJsonElement(statsMessages[0]).jsonObject
            val second = Json.parseToJsonElement(statsMessages[1]).jsonObject
            assertEquals(30L, first["dl_p2p"]?.jsonPrimitive?.content?.toLong())
            assertEquals(50L, first["dl_edge"]?.jsonPrimitive?.content?.toLong())
            assertEquals(12L, first["ul"]?.jsonPrimitive?.content?.toLong())
            assertEquals(3L, first["ice_attempts"]?.jsonPrimitive?.content?.toLong())
            assertEquals(500L, first["startup_ms"]?.jsonPrimitive?.content?.toLong())
            assertEquals(200L, first["buffer_ms"]?.jsonPrimitive?.content?.toLong())
            assertEquals(5L, second["dl_p2p"]?.jsonPrimitive?.content?.toLong())
            assertEquals(300L, second["buffer_ms"]?.jsonPrimitive?.content?.toLong())
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

    @Test
    fun reconnectsWhenJoinIsNotAcknowledgedAndKeepsTheReplacementJoined() {
        val server = MockWebServer()
        val joins = CountDownLatch(2)
        val assignmentKeys = CopyOnWriteArrayList<String>()
        val connections = AtomicInteger()
        val timeoutStats = AtomicReference<String>()
        val timeoutStatsReceived = CountDownLatch(1)
        val listener = object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                when {
                    text.contains("\"t\":\"join\"") -> {
                        Regex("\"assignmentKey\":\"([^\"]+)\"").find(text)?.groupValues?.get(1)?.let(assignmentKeys::add)
                        val connection = connections.incrementAndGet()
                        joins.countDown()
                        if (connection == 2) {
                            webSocket.send(
                                """{"t":"joined","peerId":"peer-2","cellId":"cell-a","playlistUrl":"https://edge.example.tv/live/demo/index.m3u8","edgeUrlTemplate":"https://edge.example.tv/live/demo/{seq}.m4s","originUrlTemplate":"https://origin.example.tv/live/demo/{seq}.m4s","swarmMode":"p2p","superPeer":false}"""
                            )
                        }
                    }
                    text.contains("\"t\":\"stats\"") -> {
                        timeoutStats.set(text)
                        timeoutStatsReceived.countDown()
                    }
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }
        }
        repeat(3) { server.enqueue(MockResponse().withWebSocketUpgrade(listener)) }
        server.start()

        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val tokenCalls = AtomicInteger()
        val client = TrackerClient(
            initialWsUrl = server.url("/ws").toString().replaceFirst("http", "ws").removeSuffix("/"),
            tokenProvider = { "token-${tokenCalls.incrementAndGet()}" },
            scope = scope,
            joinAckTimeoutMs = 100L
        )

        try {
            client.connect("demo", wifi = true, uploadEnabled = true)
            assertTrue("tracker did not reconnect after the missing join acknowledgement", joins.await(4, TimeUnit.SECONDS))
            assertTrue("join-timeout telemetry was not flushed after recovery", timeoutStatsReceived.await(3, TimeUnit.SECONDS))
            Thread.sleep(1_500L)
            assertEquals(2, connections.get())
            assertEquals(2, tokenCalls.get())
            assertEquals(2, assignmentKeys.size)
            assertEquals(assignmentKeys[0], assignmentKeys[1])
            assertTrue(timeoutStats.get().contains("\"tracker_join_timeouts\":1"))
        } finally {
            client.close()
            scope.cancel()
            server.shutdown()
        }
    }

    @Test
    fun carriesAuthenticatedCellRouteTokenToSpilloverTracker() {
        val primary = MockWebServer()
        val spillover = MockWebServer()
        val primaryJoin = AtomicReference<String>()
        val spilloverJoins = CopyOnWriteArrayList<String>()
        val redirected = CountDownLatch(2)
        val spilloverConnections = AtomicInteger()
        val spilloverListener = object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!text.contains("\"t\":\"join\"")) return
                spilloverJoins.add(text)
                redirected.countDown()
                if (spilloverConnections.getAndIncrement() == 0) webSocket.close(1011, "forced spillover reconnect")
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }
        }
        spillover.enqueue(MockResponse().withWebSocketUpgrade(spilloverListener))
        spillover.enqueue(MockResponse().withWebSocketUpgrade(spilloverListener))
        spillover.start()
        val spilloverUrl = spillover.url("/ws").toString().replaceFirst("http", "ws").removeSuffix("/")
        primary.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!text.contains("\"t\":\"join\"")) return
                primaryJoin.set(text)
                webSocket.send(
                    """{"t":"redirect","channelId":"demo","shardId":"cell-b","trackerUrl":"$spilloverUrl","cellId":"cell-b","cellRouteToken":"signed-route-token"}"""
                )
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }
        }))
        primary.start()

        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val client = TrackerClient(
            initialWsUrl = primary.url("/ws").toString().replaceFirst("http", "ws").removeSuffix("/"),
            tokenProvider = { "token" },
            scope = scope
        )

        try {
            client.connect("demo", wifi = true, uploadEnabled = true)
            assertTrue("tracker did not preserve spillover routing across reconnect", redirected.await(8, TimeUnit.SECONDS))
            assertTrue(!primaryJoin.get().contains("cellRouteToken"))
            assertEquals(2, spilloverJoins.size)
            assertTrue(spilloverJoins.all { it.contains("\"cellRouteToken\":\"signed-route-token\"") })
            val assignmentPattern = Regex("\"assignmentKey\":\"([^\"]+)\"")
            assertEquals(
                assignmentPattern.find(primaryJoin.get())?.groupValues?.get(1),
                assignmentPattern.find(spilloverJoins[0])?.groupValues?.get(1)
            )
            assertEquals(
                assignmentPattern.find(spilloverJoins[0])?.groupValues?.get(1),
                assignmentPattern.find(spilloverJoins[1])?.groupValues?.get(1)
            )
        } finally {
            client.close()
            scope.cancel()
            primary.shutdown()
            spillover.shutdown()
        }
    }
}
