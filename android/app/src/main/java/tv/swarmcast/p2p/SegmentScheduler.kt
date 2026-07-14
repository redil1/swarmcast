package tv.swarmcast.p2p

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import tv.swarmcast.data.ErrorCodes
import tv.swarmcast.data.apiExceptionFromResponse
import tv.swarmcast.playback.PlaybackUrls
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

data class SchedulerStats(
    val downloadedFromPeers: Long,
    val downloadedFromEdge: Long,
    val uploadedToPeers: Long = 0,
    val peerTimeouts: Long = 0,
    val peerHashFailures: Long = 0,
    val peerDisconnects: Long = 0
)

class SegmentScheduler(
    private val store: SegmentStore,
    private val http: OkHttpClient = OkHttpClient(),
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val decoderFactory: NetworkCodingDecoderFactory = NetworkCodingDecoderFactory.Disabled,
    private val encoderFactory: NetworkCodingEncoderFactory = NetworkCodingEncoderFactory.Disabled,
    private val reputation: PeerReputationBook = PeerReputationBook()
) {
    private val manifest = ConcurrentHashMap<Int, TrackerEvent.Segment>()
    private val links = ConcurrentHashMap<String, PeerLink>()
    private val codedFetch = CodedFetch(links = { links.values })
    private val activeDecoders = ConcurrentHashMap<Int, NetworkCodingDecoder>()
    private val encoders = ConcurrentHashMap<Int, NetworkCodingEncoder>()

    var edgeTemplate: String = ""
        private set
    var originTemplate: String = ""
        private set
    var authToken: String = ""
        private set
    var superPeer: Boolean = false
        private set
    var downloadedFromPeers = 0L
        private set
    var downloadedFromEdge = 0L
        private set
    private val uploadedToPeersCounter = AtomicLong(0)
    private val peerTimeoutsCounter = AtomicLong(0)
    private val peerHashFailuresCounter = AtomicLong(0)
    private val peerDisconnectsCounter = AtomicLong(0)
    val uploadedToPeers: Long
        get() = uploadedToPeersCounter.get()
    val peerTimeouts: Long
        get() = peerTimeoutsCounter.get()
    val peerHashFailures: Long
        get() = peerHashFailuresCounter.get()
    val peerDisconnects: Long
        get() = peerDisconnectsCounter.get()

    fun configure(joined: TrackerEvent.Joined, token: String) {
        edgeTemplate = joined.edgeTemplate
        originTemplate = joined.originTemplate
        superPeer = joined.superPeer
        authToken = token
    }

    fun addLink(link: PeerLink) {
        links.remove(link.peerId)?.close(notifyClosed = false)
        links[link.peerId] = link
        link.sendBitfield(store.heldSeqs())
        manifest.values.forEach { segment ->
            val localRank = if (store.get(segment.seq) != null) segment.k else activeDecoders[segment.seq]?.rank ?: 0
            if (localRank > 0) link.sendRank(segment.seq, localRank)
        }
    }

    fun removeLink(peerId: String) {
        links.remove(peerId)?.close(notifyClosed = false)
    }

    fun recordUploaded(bytes: Long) {
        if (bytes > 0L) uploadedToPeersCounter.addAndGet(bytes)
    }

    fun onSegmentAnnounce(segment: TrackerEvent.Segment) {
        manifest[segment.seq] = segment
        manifest.keys.removeIf { it < segment.seq - MANIFEST_WINDOW }
        activeDecoders.keys.removeIf { it < segment.seq - MANIFEST_WINDOW }
        encoders.keys.removeIf { it < segment.seq - MANIFEST_WINDOW }
        if (store.get(segment.seq) != null) links.values.forEach { it.sendRank(segment.seq, segment.k) }
    }

    suspend fun fetchSegment(seq: Int, fileName: String, urgencyMs: Long): ByteArray {
        store.get(seq)?.let { return it.bytes }

        tryDecodeCodedSegment(seq, urgencyMs)?.let { return it }
        tryPeers(seq, urgencyMs)?.let { return it }

        val bytes = fetchFromEdge(fileName)
        downloadedFromEdge += bytes.size
        manifest[seq]?.let { meta ->
            store.putVerified(seq, bytes, meta.sha256)
            encoders.remove(seq)
            links.values.forEach { it.sendBitfield(store.heldSeqs()) }
            links.values.forEach { it.sendRank(seq, meta.k) }
        }
        return bytes
    }

    suspend fun collectCodedPackets(seq: Int, urgencyMs: Long): List<CodedPacketCandidate> {
        val requiredRank = manifest[seq]?.k ?: return emptyList()
        return codedFetch.collect(seq, requiredRank, urgencyMs)
    }

    suspend fun tryDecodeCodedSegment(seq: Int, urgencyMs: Long): ByteArray? {
        val meta = manifest[seq] ?: return null
        if (meta.size <= 0L || meta.size > Int.MAX_VALUE) return null
        val decoder = activeDecoders.computeIfAbsent(seq) {
            decoderFactory.create(seq, meta.k, meta.size.toInt())
        }
        val acceptedPeers = LinkedHashSet<String>()
        for (packet in collectCodedPackets(seq, urgencyMs)) {
            if (decoder.accept(packet)) {
                acceptedPeers += packet.peerId
                links.values.forEach { it.sendRank(seq, decoder.rank) }
            }
            if (decoder.complete) {
                val bytes = decoder.decode()
                if (store.putVerified(seq, bytes, meta.sha256)) {
                    acceptedPeers.forEach { reputation.record(it, PeerReputationEvent.SUCCESS) }
                    downloadedFromPeers += bytes.size
                    activeDecoders.remove(seq)
                    encoders.remove(seq)
                    links.values.forEach { it.sendBitfield(store.heldSeqs()) }
                    links.values.forEach { it.sendRank(seq, meta.k) }
                    return bytes
                }
                acceptedPeers.forEach { peerId ->
                    val state = recordPeerEvent(peerId, PeerReputationEvent.HASH_MISMATCH)
                    if (state.disconnected) links[peerId]?.let(::disconnectPeer)
                }
                activeDecoders.remove(seq)
                return null
            }
        }
        return null
    }

    fun codedPacket(seq: Int): Wire.CodedPayload? {
        activeDecoders[seq]?.recode()?.let { return it }
        val meta = manifest[seq] ?: return null
        val stored = store.get(seq) ?: return null
        val encoder = encoders[seq] ?: encoderFactory.create(seq, meta.k, stored.bytes)?.let { created ->
            encoders.putIfAbsent(seq, created) ?: created
        } ?: return null
        return encoder.generate()
    }

    fun stats(): SchedulerStats =
        SchedulerStats(
            downloadedFromPeers = downloadedFromPeers,
            downloadedFromEdge = downloadedFromEdge,
            uploadedToPeers = uploadedToPeers,
            peerTimeouts = peerTimeouts,
            peerHashFailures = peerHashFailures,
            peerDisconnects = peerDisconnects
        )

    private suspend fun tryPeers(seq: Int, urgencyMs: Long): ByteArray? {
        val meta = manifest[seq] ?: return null
        val candidates = links.values
            .filter { it.remoteHas.contains(seq) && !reputation.isDisconnected(it.peerId) }
            .sortedByDescending { reputation.score(it.peerId) }
            .take(MAX_PEER_ATTEMPTS)
        if (candidates.isEmpty()) return null

        val perPeerTimeout = (urgencyMs / candidates.size).coerceAtLeast(MIN_PEER_TIMEOUT_MS)

        for (link in candidates) {
            val deferred = link.request(seq)
            val bytes = withTimeoutOrNull(perPeerTimeout) { deferred.await() }
            if (bytes == null) {
                link.cancel(seq)
                recordPeerEvent(link, PeerReputationEvent.TIMEOUT)
                continue
            }

            if (!store.putVerified(seq, bytes, meta.sha256)) {
                recordPeerEvent(link, PeerReputationEvent.HASH_MISMATCH)
                continue
            }

            recordPeerEvent(link, PeerReputationEvent.SUCCESS)
            downloadedFromPeers += bytes.size
            links.values.forEach { it.sendBitfield(store.heldSeqs()) }
            links.values.forEach { it.sendRank(seq, meta.k) }
            return bytes
        }
        return null
    }

    private fun recordPeerEvent(link: PeerLink, event: PeerReputationEvent): PeerReputationSnapshot {
        val state = recordPeerEvent(link.peerId, event)
        if (state.disconnected) disconnectPeer(link)
        return state
    }

    private fun recordPeerEvent(peerId: String, event: PeerReputationEvent): PeerReputationSnapshot {
        when (event) {
            PeerReputationEvent.TIMEOUT -> peerTimeoutsCounter.incrementAndGet()
            PeerReputationEvent.HASH_MISMATCH -> peerHashFailuresCounter.incrementAndGet()
            else -> Unit
        }
        return reputation.record(peerId, event)
    }

    private fun disconnectPeer(link: PeerLink) {
        if (links.remove(link.peerId, link)) {
            peerDisconnectsCounter.incrementAndGet()
        }
        link.close()
    }

    private suspend fun fetchFromEdge(fileName: String): ByteArray = withContext(Dispatchers.IO) {
        require(edgeTemplate.isNotBlank()) { "edge template is not configured" }
        require(authToken.isNotBlank()) { "auth token is not configured" }

        val request = Request.Builder()
            .url(PlaybackUrls.segmentUrl(edgeTemplate, fileName, authToken))
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw apiExceptionFromResponse(json, response.body?.string(), response.code, ErrorCodes.EDGE_UNAVAILABLE)
            }
            response.body?.bytes() ?: error("empty edge segment response")
        }
    }

    companion object {
        private const val MANIFEST_WINDOW = 90
        private const val MAX_PEER_ATTEMPTS = 4
        private const val MIN_PEER_TIMEOUT_MS = 250L
    }
}
