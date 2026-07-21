package tv.swarmcast.p2p

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import tv.swarmcast.data.ErrorCodes
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random

sealed class TrackerEvent {
    data class Joined(
        val peerId: String,
        val playlistUrl: String,
        val edgeTemplate: String,
        val originTemplate: String,
        val swarmMode: String,
        val superPeer: Boolean,
        val cellId: String = "default"
    ) : TrackerEvent()

    data class Peers(val peers: List<PeerInfo>) : TrackerEvent()
    data class SwarmMode(val swarmMode: String, val swarmSize: Int) : TrackerEvent()
    data class Signal(val from: String, val data: JsonObject) : TrackerEvent()
    data class Segment(val seq: Int, val sha256: String, val size: Long, val k: Int, val seedTier: Boolean) : TrackerEvent()
    data class Redirect(
        val channelId: String,
        val shardId: String,
        val trackerUrl: String,
        val cellId: String = "default",
        val cellRouteToken: String? = null
    ) : TrackerEvent()
    data class Error(val code: String, val message: String = "") : TrackerEvent()
    data object Disconnected : TrackerEvent()
}

data class PeerInfo(val id: String, val transport: String, val superPeer: Boolean = false)

class TrackerClient(
    private val initialWsUrl: String,
    private val tokenProvider: suspend () -> String,
    private val scope: CoroutineScope,
    private val http: OkHttpClient = OkHttpClient.Builder().pingInterval(45, TimeUnit.SECONDS).build(),
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val joinAckTimeoutMs: Long = DEFAULT_JOIN_ACK_TIMEOUT_MS
) {
    init {
        require(joinAckTimeoutMs > 0L) { "join acknowledgement timeout must be positive" }
    }

    val events = MutableSharedFlow<TrackerEvent>(extraBufferCapacity = 256)
    private var ws: WebSocket? = null
    private var activeJoin: JoinRequest? = null
    private var redirectHops = 0
    private var targetWsUrl = initialWsUrl
    private var cellRouteToken: String? = null
    private var reconnectAttempt = 0
    private var reconnectJob: Job? = null
    private var joinAckJob: Job? = null
    private var connectionGeneration = 0L
    private var closedByUser = true
    private val assignmentKey = UUID.randomUUID().toString()

    fun connect(
        channelId: String,
        wifi: Boolean,
        uploadEnabled: Boolean,
        uplinkKbps: Int = 0,
        networkClass: String = if (wifi) "wifi" else "cellular"
    ) {
        connectionGeneration += 1
        ws?.close(1000, "replaced")
        ws = null
        reconnectJob?.cancel()
        reconnectJob = null
        joinAckJob?.cancel()
        joinAckJob = null
        activeJoin = JoinRequest(channelId, wifi, uploadEnabled, uplinkKbps, networkClass)
        redirectHops = 0
        reconnectAttempt = 0
        targetWsUrl = initialWsUrl
        cellRouteToken = null
        closedByUser = false
        scope.launch {
            openWebSocket(targetWsUrl, activeJoin ?: return@launch)
        }
    }

    private suspend fun openWebSocket(targetWsUrl: String, join: JoinRequest) {
        if (closedByUser || activeJoin != join) return
        val token = runCatching { tokenProvider() }.getOrElse {
            scheduleReconnect()
            return
        }
        val request = Request.Builder().url("$targetWsUrl?token=$token").build()
        val generation = ++connectionGeneration
        ws = http.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (!isCurrent(generation)) return
                    if (!webSocket.send(joinMessage(join).toString())) {
                        webSocket.cancel()
                        handleDisconnect(generation)
                        return
                    }
                    armJoinAckWatchdog(generation, webSocket)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (!isCurrent(generation)) return
                    when (val event = runCatching { parseEvent(text) }.getOrNull()) {
                        is TrackerEvent.Redirect -> {
                            cancelJoinAckWatchdog()
                            redirectTo(event)
                        }
                        is TrackerEvent.Joined -> {
                            cancelJoinAckWatchdog()
                            reconnectAttempt = 0
                            redirectHops = 0
                            events.tryEmit(event)
                        }
                        is TrackerEvent.Error -> {
                            cancelJoinAckWatchdog()
                            events.tryEmit(event)
                        }
                        null -> Unit
                        else -> events.tryEmit(event)
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    handleDisconnect(generation)
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, reason)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    handleDisconnect(generation)
                }
            })
    }

    private fun isCurrent(generation: Long): Boolean = !closedByUser && generation == connectionGeneration

    private fun handleDisconnect(generation: Long) {
        if (!isCurrent(generation)) return
        cancelJoinAckWatchdog()
        connectionGeneration += 1
        ws = null
        events.tryEmit(TrackerEvent.Disconnected)
        scheduleReconnect()
    }

    private fun armJoinAckWatchdog(generation: Long, webSocket: WebSocket) {
        cancelJoinAckWatchdog()
        joinAckJob = scope.launch {
            delay(joinAckTimeoutMs)
            if (!isCurrent(generation) || ws !== webSocket) return@launch
            joinAckJob = null
            connectionGeneration += 1
            ws = null
            events.tryEmit(TrackerEvent.Disconnected)
            webSocket.cancel()
            scheduleReconnect()
        }
    }

    private fun cancelJoinAckWatchdog() {
        joinAckJob?.cancel()
        joinAckJob = null
    }

    private fun scheduleReconnect() {
        val join = activeJoin ?: return
        if (closedByUser || reconnectJob?.isActive == true) return
        val exponent = min(reconnectAttempt, MAX_RECONNECT_EXPONENT)
        val baseDelayMs = min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * (1L shl exponent))
        val jitterMs = Random.nextLong(0L, (baseDelayMs / 4L) + 1L)
        reconnectAttempt += 1
        reconnectJob = scope.launch {
            delay(baseDelayMs + jitterMs)
            reconnectJob = null
            openWebSocket(targetWsUrl, join)
        }
    }

    private fun joinMessage(join: JoinRequest) = buildJsonObject {
        put("t", "join")
        put("channelId", join.channelId)
        put("assignmentKey", assignmentKey)
        cellRouteToken?.takeIf { it.isNotBlank() }?.let { put("cellRouteToken", it) }
        putJsonObject("caps") {
            put("upload", join.uploadEnabled && join.wifi)
            put("transport", join.networkClass.takeIf { it in NETWORK_CLASSES } ?: "unknown")
            put("uplinkKbps", join.uplinkKbps)
        }
    }

    private fun redirectTo(event: TrackerEvent.Redirect) {
        val join = activeJoin ?: return
        if (redirectHops >= MAX_TRACKER_REDIRECTS) {
            events.tryEmit(TrackerEvent.Error(ErrorCodes.CONFIG_INVALID, "tracker redirect limit exceeded"))
            return
        }
        redirectHops += 1
        targetWsUrl = event.trackerUrl
        cellRouteToken = event.cellRouteToken
        connectionGeneration += 1
        val previous = ws
        ws = null
        previous?.close(1012, "tracker shard redirect")
        scope.launch {
            openWebSocket(targetWsUrl, join)
        }
    }

    fun announceHave(seqs: List<Int>) = sendJson(buildJsonObject {
        put("t", "have")
        putJsonArray("seqs") { seqs.forEach { add(JsonPrimitive(it)) } }
    })

    fun signal(to: String, data: JsonObject) = sendJson(buildJsonObject {
        put("t", "signal")
        put("to", to)
        put("data", data)
    })

    fun requestPeers(excludePeerIds: Collection<String> = emptyList()) = sendJson(buildJsonObject {
        put("t", "need_peers")
        putJsonArray("exclude") {
            excludePeerIds.asSequence()
                .filter { it.isNotBlank() }
                .distinct()
                .take(MAX_EXCLUDED_PEERS)
                .forEach { add(JsonPrimitive(it)) }
        }
    })

    fun reportStats(
        dlP2p: Long,
        dlEdge: Long,
        ul: Long,
        dlBootstrapOrigin: Long = 0,
        dlRelay: Long = 0,
        stalls: Int = 0,
        startupMs: Long? = null,
        bufferMs: Long? = null,
        peerTimeouts: Long = 0,
        hashFailures: Long = 0,
        peerDisconnects: Long = 0,
        ice: IceConnectivityDelta = IceConnectivityDelta()
    ) = sendJson(buildJsonObject {
        put("t", "stats")
        put("dl_p2p", dlP2p)
        put("dl_edge", dlEdge)
        put("dl_bootstrap_origin", dlBootstrapOrigin)
        put("dl_relay", dlRelay)
        put("ul", ul)
        put("stalls", stalls)
        put("peer_timeouts", peerTimeouts.coerceAtLeast(0L))
        put("hash_failures", hashFailures.coerceAtLeast(0L))
        put("peer_disconnects", peerDisconnects.coerceAtLeast(0L))
        put("ice_attempts", ice.attempts.coerceAtLeast(0L))
        put("ice_successes", ice.successes.coerceAtLeast(0L))
        put("ice_failures", ice.failures.coerceAtLeast(0L))
        put("ice_candidate_host", ice.hostSuccesses.coerceAtLeast(0L))
        put("ice_candidate_srflx", ice.srflxSuccesses.coerceAtLeast(0L))
        put("ice_candidate_prflx", ice.prflxSuccesses.coerceAtLeast(0L))
        put("ice_candidate_relay", ice.relaySuccesses.coerceAtLeast(0L))
        put("ice_candidate_unknown", ice.unknownSuccesses.coerceAtLeast(0L))
        startupMs?.let { put("startup_ms", it.coerceAtLeast(0L)) }
        bufferMs?.let { put("buffer_ms", it.coerceAtLeast(0L)) }
    })

    fun close() {
        closedByUser = true
        activeJoin = null
        cancelJoinAckWatchdog()
        reconnectJob?.cancel()
        reconnectJob = null
        connectionGeneration += 1
        val previous = ws
        ws = null
        previous?.close(1000, "closed")
    }

    private fun sendJson(obj: JsonObject) {
        ws?.send(obj.toString())
    }

    private fun parseEvent(text: String): TrackerEvent? {
        val obj = json.parseToJsonElement(text).jsonObject
        return when (obj["t"]?.jsonPrimitive?.contentOrNull) {
            "joined" -> TrackerEvent.Joined(
                peerId = obj["peerId"]!!.jsonPrimitive.content,
                playlistUrl = obj["playlistUrl"]!!.jsonPrimitive.content,
                edgeTemplate = obj["edgeUrlTemplate"]!!.jsonPrimitive.content,
                originTemplate = obj["originUrlTemplate"]!!.jsonPrimitive.content,
                swarmMode = obj["swarmMode"]?.jsonPrimitive?.contentOrNull ?: "p2p",
                superPeer = obj["superPeer"]?.jsonPrimitive?.boolean ?: false,
                cellId = obj["cellId"]?.jsonPrimitive?.contentOrNull ?: "default"
            )
            "peers" -> TrackerEvent.Peers(obj["peers"]!!.jsonArray.map {
                val peer = it.jsonObject
                PeerInfo(
                    id = peer["id"]!!.jsonPrimitive.content,
                    transport = peer["transport"]!!.jsonPrimitive.content,
                    superPeer = peer["superPeer"]?.jsonPrimitive?.boolean ?: false
                )
            })
            "swarm_mode" -> TrackerEvent.SwarmMode(
                swarmMode = obj["swarmMode"]?.jsonPrimitive?.contentOrNull ?: "edge-only",
                swarmSize = obj["swarmSize"]?.jsonPrimitive?.int ?: 0
            )
            "signal" -> TrackerEvent.Signal(
                from = obj["from"]!!.jsonPrimitive.content,
                data = obj["data"]!!.jsonObject
            )
            "segment" -> TrackerEvent.Segment(
                seq = obj["seq"]!!.jsonPrimitive.int,
                sha256 = obj["sha256"]!!.jsonPrimitive.content,
                size = obj["size"]!!.jsonPrimitive.long,
                k = obj["k"]!!.jsonPrimitive.int,
                seedTier = obj["seedTier"]!!.jsonPrimitive.boolean
            )
            "redirect" -> TrackerEvent.Redirect(
                channelId = obj["channelId"]!!.jsonPrimitive.content,
                shardId = obj["shardId"]!!.jsonPrimitive.content,
                trackerUrl = obj["trackerUrl"]!!.jsonPrimitive.content,
                cellId = obj["cellId"]?.jsonPrimitive?.contentOrNull ?: "default",
                cellRouteToken = obj["cellRouteToken"]?.jsonPrimitive?.contentOrNull
            )
            "error" -> TrackerEvent.Error(
                code = obj["code"]?.jsonPrimitive?.contentOrNull ?: ErrorCodes.CONFIG_INVALID,
                message = obj["msg"]?.jsonPrimitive?.contentOrNull ?: ""
            )
            else -> null
        }
    }

    private data class JoinRequest(
        val channelId: String,
        val wifi: Boolean,
        val uploadEnabled: Boolean,
        val uplinkKbps: Int,
        val networkClass: String
    )

    companion object {
        private const val MAX_TRACKER_REDIRECTS = 64
        private const val MAX_EXCLUDED_PEERS = 64
        private const val BASE_RECONNECT_DELAY_MS = 1_000L
        private const val MAX_RECONNECT_DELAY_MS = 30_000L
        private const val MAX_RECONNECT_EXPONENT = 5
        private const val DEFAULT_JOIN_ACK_TIMEOUT_MS = 10_000L
        private val NETWORK_CLASSES = setOf("wifi", "cellular", "ethernet", "unknown")
    }
}
