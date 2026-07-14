package tv.swarmcast.p2p

import kotlinx.coroutines.CoroutineScope
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
import java.util.concurrent.TimeUnit

sealed class TrackerEvent {
    data class Joined(
        val peerId: String,
        val playlistUrl: String,
        val edgeTemplate: String,
        val originTemplate: String,
        val swarmMode: String,
        val superPeer: Boolean
    ) : TrackerEvent()

    data class Peers(val peers: List<PeerInfo>) : TrackerEvent()
    data class Signal(val from: String, val data: JsonObject) : TrackerEvent()
    data class Segment(val seq: Int, val sha256: String, val size: Long, val k: Int, val seedTier: Boolean) : TrackerEvent()
    data class Redirect(val channelId: String, val shardId: String, val trackerUrl: String) : TrackerEvent()
    data class Error(val code: String, val message: String = "") : TrackerEvent()
    data object Disconnected : TrackerEvent()
}

data class PeerInfo(val id: String, val transport: String, val superPeer: Boolean = false)

class TrackerClient(
    private val initialWsUrl: String,
    private val tokenProvider: suspend () -> String,
    private val scope: CoroutineScope,
    private val http: OkHttpClient = OkHttpClient.Builder().pingInterval(45, TimeUnit.SECONDS).build(),
    private val json: Json = Json { ignoreUnknownKeys = true }
) {
    val events = MutableSharedFlow<TrackerEvent>(extraBufferCapacity = 256)
    private var ws: WebSocket? = null
    private var activeJoin: JoinRequest? = null
    private var redirectHops = 0
    private var suppressNextDisconnect = false

    fun connect(channelId: String, wifi: Boolean, uploadEnabled: Boolean, uplinkKbps: Int = 0) {
        activeJoin = JoinRequest(channelId, wifi, uploadEnabled, uplinkKbps)
        redirectHops = 0
        scope.launch {
            openWebSocket(initialWsUrl, activeJoin ?: return@launch)
        }
    }

    private suspend fun openWebSocket(targetWsUrl: String, join: JoinRequest) {
        val token = tokenProvider()
        val request = Request.Builder().url("$targetWsUrl?token=$token").build()
        ws = http.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(joinMessage(join).toString())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    when (val event = parseEvent(text)) {
                        is TrackerEvent.Redirect -> redirectTo(event)
                        null -> Unit
                        else -> events.tryEmit(event)
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (suppressNextDisconnect) suppressNextDisconnect = false else events.tryEmit(TrackerEvent.Disconnected)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (suppressNextDisconnect) suppressNextDisconnect = false else events.tryEmit(TrackerEvent.Disconnected)
                }
            })
    }

    private fun joinMessage(join: JoinRequest) = buildJsonObject {
        put("t", "join")
        put("channelId", join.channelId)
        putJsonObject("caps") {
            put("upload", join.uploadEnabled && join.wifi)
            put("transport", if (join.wifi) "wifi" else "cell")
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
        suppressNextDisconnect = true
        ws?.close(1012, "tracker shard redirect")
        scope.launch {
            openWebSocket(event.trackerUrl, join)
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

    fun reportStats(
        dlP2p: Long,
        dlEdge: Long,
        ul: Long,
        stalls: Int = 0,
        startupMs: Long? = null,
        bufferMs: Long? = null,
        peerTimeouts: Long = 0,
        hashFailures: Long = 0,
        peerDisconnects: Long = 0
    ) = sendJson(buildJsonObject {
        put("t", "stats")
        put("dl_p2p", dlP2p)
        put("dl_edge", dlEdge)
        put("ul", ul)
        put("stalls", stalls)
        put("peer_timeouts", peerTimeouts.coerceAtLeast(0L))
        put("hash_failures", hashFailures.coerceAtLeast(0L))
        put("peer_disconnects", peerDisconnects.coerceAtLeast(0L))
        startupMs?.let { put("startup_ms", it.coerceAtLeast(0L)) }
        bufferMs?.let { put("buffer_ms", it.coerceAtLeast(0L)) }
    })

    fun close() {
        ws?.close(1000, "closed")
        ws = null
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
                superPeer = obj["superPeer"]?.jsonPrimitive?.boolean ?: false
            )
            "peers" -> TrackerEvent.Peers(obj["peers"]!!.jsonArray.map {
                val peer = it.jsonObject
                PeerInfo(
                    id = peer["id"]!!.jsonPrimitive.content,
                    transport = peer["transport"]!!.jsonPrimitive.content,
                    superPeer = peer["superPeer"]?.jsonPrimitive?.boolean ?: false
                )
            })
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
                trackerUrl = obj["trackerUrl"]!!.jsonPrimitive.content
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
        val uplinkKbps: Int
    )

    companion object {
        private const val MAX_TRACKER_REDIRECTS = 3
    }
}
