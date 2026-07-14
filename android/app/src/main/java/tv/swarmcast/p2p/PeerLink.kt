package tv.swarmcast.p2p

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.webrtc.DataChannel
import java.io.ByteArrayOutputStream

class PeerLink(
    val peerId: String,
    private val channel: DataChannel,
    private val store: SegmentStore,
    private val uploadBudget: UploadBudget,
    private val scope: CoroutineScope,
    private val codedPacketProvider: (seq: Int) -> Wire.CodedPayload? = { null },
    private val onBitfield: (peerId: String, seqs: Set<Int>) -> Unit = { _, _ -> },
    private val onClosed: (peerId: String) -> Unit = {},
    private val onUploaded: (peerId: String, bytes: Long) -> Unit = { _, _ -> }
) : DataChannel.Observer {
    val remoteHas = LinkedHashSet<Int>()
    val remoteRanks = LinkedHashMap<Int, Int>()
    var failures = 0
        private set
    var successes = 0
        private set

    private var inflight: Pair<Int, CompletableDeferred<ByteArray?>>? = null
    private var codedInflight: Pair<Int, CompletableDeferred<Wire.CodedPayload?>>? = null
    private var rxBuffer = ByteArrayOutputStream()
    @Volatile
    private var closed = false

    init {
        channel.registerObserver(this)
    }

    fun request(seq: Int): CompletableDeferred<ByteArray?> {
        val deferred = CompletableDeferred<ByteArray?>()
        if (!isOpen()) {
            deferred.complete(null)
            return deferred
        }
        inflight = seq to deferred
        rxBuffer = ByteArrayOutputStream()
        sendFrame(Wire.REQUEST, seq)
        return deferred
    }

    fun requestCoded(seq: Int): CompletableDeferred<Wire.CodedPayload?> {
        val deferred = CompletableDeferred<Wire.CodedPayload?>()
        if (!isOpen()) {
            deferred.complete(null)
            return deferred
        }
        codedInflight = seq to deferred
        sendFrame(Wire.CODED_REQUEST, seq)
        return deferred
    }

    fun cancel(seq: Int) {
        sendFrame(Wire.CANCEL, seq)
        inflight?.let { pending ->
            if (pending.first == seq) {
                pending.second.complete(null)
                inflight = null
            }
        }
        codedInflight?.let { pending ->
            if (pending.first == seq) {
                pending.second.complete(null)
                codedInflight = null
            }
        }
    }

    fun sendBitfield(seqs: Collection<Int>) {
        sendFrame(Wire.BITFIELD, 0, Wire.bitfield(seqs))
    }

    fun sendRank(seq: Int, rank: Int) {
        sendFrame(Wire.RANK, seq, Wire.rankPayload(seq, rank))
    }

    fun sendCoded(seq: Int, coeffs: ByteArray, data: ByteArray) {
        if (sendFrame(Wire.CODED, seq, Wire.codedPayload(coeffs, data))) {
            onUploaded(peerId, (coeffs.size + data.size).toLong())
        }
    }

    fun rankFor(seq: Int): Int = remoteRanks[seq] ?: 0

    override fun onMessage(buffer: DataChannel.Buffer) {
        if (closed) return
        val msg = Wire.parse(buffer.data) ?: return
        when (msg.type) {
            Wire.BITFIELD -> {
                Wire.parseBitfield(msg.payload)?.let { seqs ->
                    remoteHas.addAll(seqs)
                    onBitfield(peerId, remoteHas.toSet())
                }
            }
            Wire.DATA -> inflight?.let { pending ->
                if (pending.first == msg.seq) rxBuffer.write(msg.payload)
            }
            Wire.DATA_END -> inflight?.let { pending ->
                if (pending.first == msg.seq) {
                    successes += 1
                    pending.second.complete(rxBuffer.toByteArray())
                    inflight = null
                }
            }
            Wire.REJECT -> {
                var rejected = false
                inflight?.let { pending ->
                    if (pending.first == msg.seq) {
                        pending.second.complete(null)
                        inflight = null
                        rejected = true
                    }
                }
                codedInflight?.let { pending ->
                    if (pending.first == msg.seq) {
                        pending.second.complete(null)
                        codedInflight = null
                        rejected = true
                    }
                }
                if (rejected) failures += 1
            }
            Wire.CODED -> codedInflight?.let { pending ->
                if (pending.first == msg.seq) {
                    pending.second.complete(Wire.parseCodedPayload(msg.payload))
                    codedInflight = null
                }
            }
            Wire.RANK -> Wire.parseRankPayload(msg.payload)?.let { rank ->
                remoteRanks[rank.seq] = rank.rank
            }
            Wire.REQUEST -> serve(msg.seq)
            Wire.CODED_REQUEST -> serveCoded(msg.seq)
            Wire.CANCEL -> Unit
        }
    }

    override fun onStateChange() {
        if (channel.state() == DataChannel.State.CLOSED) {
            close()
        }
    }
    override fun onBufferedAmountChange(previousAmount: Long) {}

    fun close(notifyClosed: Boolean = true) {
        if (closed) return
        closed = true
        inflight?.second?.complete(null)
        inflight = null
        codedInflight?.second?.complete(null)
        codedInflight = null
        remoteHas.clear()
        remoteRanks.clear()
        rxBuffer = ByteArrayOutputStream()
        runCatching { channel.unregisterObserver() }
        channel.close()
        runCatching { channel.dispose() }
        if (notifyClosed) onClosed(peerId)
    }

    private fun serve(seq: Int) {
        val entry = store.get(seq)
        when {
            entry == null -> sendFrame(Wire.REJECT, seq, byteArrayOf(REJECT_MISSING))
            !uploadBudget.tryReserve(entry.bytes.size.toLong()) ->
                sendFrame(Wire.REJECT, seq, byteArrayOf(REJECT_QUOTA))
            else -> scope.launch(Dispatchers.IO) {
                var offset = 0
                var uploaded = 0L
                while (offset < entry.bytes.size && isOpen()) {
                    while (isOpen() && channel.bufferedAmount() > MAX_BUFFERED_BYTES) delay(5)
                    if (!isOpen()) break
                    val len = minOf(Wire.CHUNK, entry.bytes.size - offset)
                    if (!sendFrame(Wire.DATA, seq, entry.bytes.copyOfRange(offset, offset + len))) break
                    offset += len
                    uploaded += len
                }
                if (uploaded > 0L) onUploaded(peerId, uploaded)
                if (offset >= entry.bytes.size) sendFrame(Wire.DATA_END, seq)
            }
        }
    }

    private fun serveCoded(seq: Int) {
        val packet = codedPacketProvider(seq)
        when {
            packet == null -> sendFrame(Wire.REJECT, seq, byteArrayOf(REJECT_MISSING))
            !uploadBudget.tryReserve((packet.coeffs.size + packet.data.size).toLong()) ->
                sendFrame(Wire.REJECT, seq, byteArrayOf(REJECT_QUOTA))
            else -> sendCoded(seq, packet.coeffs, packet.data)
        }
    }

    private fun sendFrame(type: Byte, seq: Int, payload: ByteArray = ByteArray(0)): Boolean =
        if (isOpen()) {
            runCatching { channel.send(DataChannel.Buffer(Wire.frame(type, seq, payload), true)) }.getOrDefault(false)
        } else {
            false
        }

    private fun isOpen(): Boolean = !closed && channel.state() == DataChannel.State.OPEN

    companion object {
        const val REJECT_MISSING: Byte = 1
        const val REJECT_QUOTA: Byte = 3
        private const val MAX_BUFFERED_BYTES = 1_000_000L
    }
}
