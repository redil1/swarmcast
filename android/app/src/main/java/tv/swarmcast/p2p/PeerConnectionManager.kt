package tv.swarmcast.p2p

import android.content.Context
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.nio.ByteBuffer

class PeerConnectionManager(
    context: Context,
    private val tracker: TrackerClient,
    private val maxPeers: Int = 12,
    iceServerUrls: List<String> = listOf(
        "stun:stun.l.google.com:19302",
        "stun:stun.cloudflare.com:3478"
    ),
    private val onOpen: (peerId: String, channel: DataChannel, closePeer: () -> Unit) -> Unit = { _, _, _ -> },
    private val onMessage: (peerId: String, bytes: ByteArray) -> Unit = { _, _ -> },
    private val onClosed: (peerId: String) -> Unit = {}
) {
    private val appContext = context.applicationContext
    private val factory: PeerConnectionFactory
    private val peers = LinkedHashMap<String, PeerConnection>()
    private val channels = LinkedHashMap<String, DataChannel>()
    private val iceServers = iceServerUrls.map {
        PeerConnection.IceServer.builder(it).createIceServer()
    }

    val connectedCount: Int
        get() = channels.count { it.value.state() == DataChannel.State.OPEN }

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(appContext)
                .createInitializationOptions()
        )
        factory = PeerConnectionFactory.builder().createPeerConnectionFactory()
    }

    fun connectTo(peer: PeerInfo) {
        if (peer.id.isBlank() || peers.containsKey(peer.id) || peers.size >= maxPeers) return
        val pc = createPeerConnection(peer.id) ?: return
        val dc = pc.createDataChannel("sc-data", DataChannel.Init().apply { ordered = true })
        wireDataChannel(peer.id, dc)
        pc.createOffer(sdpObserver { sdp ->
            pc.setLocalDescription(sdpObserver(), sdp)
            tracker.signal(peer.id, buildJsonObject {
                put("kind", "offer")
                put("sdp", sdp.description)
            })
        }, MediaConstraints())
    }

    fun onSignal(event: TrackerEvent.Signal) {
        onSignal(event.from, event.data)
    }

    fun onSignal(from: String, data: JsonObject) {
        if (from.isBlank()) return
        when (data["kind"]?.jsonPrimitive?.content) {
            "offer" -> acceptOffer(from, data)
            "answer" -> peers[from]?.setRemoteDescription(
                sdpObserver(),
                SessionDescription(SessionDescription.Type.ANSWER, data["sdp"]!!.jsonPrimitive.content)
            )
            "ice" -> peers[from]?.addIceCandidate(
                IceCandidate(
                    data["mid"]!!.jsonPrimitive.content,
                    data["mline"]!!.jsonPrimitive.int,
                    data["cand"]!!.jsonPrimitive.content
                )
            )
        }
    }

    fun send(peerId: String, bytes: ByteArray): Boolean {
        val dc = channels[peerId] ?: return false
        if (dc.state() != DataChannel.State.OPEN) return false
        return dc.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), true))
    }

    fun close(peerId: String) {
        val channel = channels.remove(peerId)
        val peer = peers.remove(peerId)
        if (channel == null && peer == null) return

        channel?.let(::closeDataChannel)
        peer?.let(::closePeerConnection)
        onClosed(peerId)
    }

    fun closeAll() {
        (peers.keys + channels.keys).toSet().forEach(::close)
    }

    private fun acceptOffer(peerId: String, data: JsonObject) {
        if (!peers.containsKey(peerId) && peers.size >= maxPeers) return
        val pc = peers[peerId] ?: createPeerConnection(peerId) ?: return
        pc.setRemoteDescription(
            sdpObserver(),
            SessionDescription(SessionDescription.Type.OFFER, data["sdp"]!!.jsonPrimitive.content)
        )
        pc.createAnswer(sdpObserver { sdp ->
            pc.setLocalDescription(sdpObserver(), sdp)
            tracker.signal(peerId, buildJsonObject {
                put("kind", "answer")
                put("sdp", sdp.description)
            })
        }, MediaConstraints())
    }

    private fun createPeerConnection(peerId: String): PeerConnection? {
        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        val pc = factory.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                tracker.signal(peerId, buildJsonObject {
                    put("kind", "ice")
                    put("mid", candidate.sdpMid)
                    put("mline", candidate.sdpMLineIndex)
                    put("cand", candidate.sdp)
                })
            }

            override fun onDataChannel(channel: DataChannel) {
                wireDataChannel(peerId, channel)
            }

            override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                if (state.isTerminal()) {
                    close(peerId)
                }
            }

            override fun onSignalingChange(state: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                if (state == PeerConnection.IceConnectionState.FAILED ||
                    state == PeerConnection.IceConnectionState.CLOSED ||
                    state == PeerConnection.IceConnectionState.DISCONNECTED
                ) {
                    close(peerId)
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onAddStream(stream: MediaStream) {}
            override fun onRemoveStream(stream: MediaStream) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {}
        }) ?: return null

        peers[peerId] = pc
        return pc
    }

    private fun wireDataChannel(peerId: String, channel: DataChannel) {
        channels.remove(peerId)?.let(::closeDataChannel)
        channels[peerId] = channel
        channel.registerObserver(object : DataChannel.Observer {
            private var opened = false

            override fun onStateChange() {
                when (channel.state()) {
                    DataChannel.State.OPEN -> if (!opened) {
                        opened = true
                        onOpen(peerId, channel) { close(peerId) }
                    }
                    DataChannel.State.CLOSED -> close(peerId)
                    else -> Unit
                }
            }

            override fun onMessage(buffer: DataChannel.Buffer) {
                val bytes = ByteArray(buffer.data.remaining())
                buffer.data.get(bytes)
                onMessage(peerId, bytes)
            }

            override fun onBufferedAmountChange(previousAmount: Long) {}
        })
    }

    private fun PeerConnection.PeerConnectionState.isTerminal(): Boolean =
        this == PeerConnection.PeerConnectionState.FAILED ||
            this == PeerConnection.PeerConnectionState.CLOSED ||
            this == PeerConnection.PeerConnectionState.DISCONNECTED

    private fun closeDataChannel(channel: DataChannel) {
        runCatching { channel.unregisterObserver() }
        runCatching { channel.close() }
        runCatching { channel.dispose() }
    }

    private fun closePeerConnection(peer: PeerConnection) {
        runCatching { peer.close() }
        runCatching { peer.dispose() }
    }

    private fun sdpObserver(onCreateSuccess: (SessionDescription) -> Unit = {}) = object : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = onCreateSuccess(description)
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String) {}
        override fun onSetFailure(error: String) {}
    }
}
