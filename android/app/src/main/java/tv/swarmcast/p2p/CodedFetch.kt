package tv.swarmcast.p2p

import kotlinx.coroutines.withTimeoutOrNull

data class CodedPacketCandidate(
    val peerId: String,
    val seq: Int,
    val coeffs: ByteArray,
    val data: ByteArray
)

class CodedFetch(
    private val links: () -> Collection<PeerLink>,
    private val maxPeerAttempts: Int = 8,
    private val minPeerTimeoutMs: Long = 200
) {
    suspend fun collect(seq: Int, requiredRank: Int, urgencyMs: Long): List<CodedPacketCandidate> {
        if (requiredRank <= 0) return emptyList()

        val candidates = links()
            .filter { it.rankFor(seq) > 0 }
            .sortedByDescending { it.rankFor(seq) }
            .take(maxPeerAttempts)
        if (candidates.isEmpty()) return emptyList()

        val deadlineNanos = System.nanoTime() + urgencyMs.coerceAtLeast(0L) * 1_000_000L
        val packets = ArrayList<CodedPacketCandidate>(requiredRank)
        var attempt = 0

        while (packets.size < requiredRank && attempt < requiredRank + MAX_EXTRA_PACKETS) {
            val remainingMs = ((deadlineNanos - System.nanoTime()) / 1_000_000L).coerceAtLeast(0L)
            if (remainingMs == 0L) break
            val link = candidates[attempt % candidates.size]
            attempt += 1
            val deferred = link.requestCoded(seq)
            val payload = withTimeoutOrNull(minOf(remainingMs, minPeerTimeoutMs.coerceAtLeast(1L))) {
                deferred.await()
            }
            if (payload == null) {
                link.cancel(seq)
                continue
            }

            packets += CodedPacketCandidate(
                peerId = link.peerId,
                seq = seq,
                coeffs = payload.coeffs,
                data = payload.data
            )
        }

        return packets
    }

    companion object {
        private const val MAX_EXTRA_PACKETS = 8
    }
}
