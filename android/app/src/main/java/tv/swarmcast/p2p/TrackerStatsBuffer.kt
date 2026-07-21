package tv.swarmcast.p2p

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

internal class TrackerStatsBuffer {
    private var dlP2p = 0L
    private var dlEdge = 0L
    private var dlBootstrapOrigin = 0L
    private var dlRelay = 0L
    private var ul = 0L
    private var stalls = 0L
    private var peerTimeouts = 0L
    private var hashFailures = 0L
    private var peerDisconnects = 0L
    private var joinTimeouts = 0L
    private var iceAttempts = 0L
    private var iceSuccesses = 0L
    private var iceFailures = 0L
    private var iceCandidateHost = 0L
    private var iceCandidateSrflx = 0L
    private var iceCandidatePrflx = 0L
    private var iceCandidateRelay = 0L
    private var iceCandidateUnknown = 0L
    private var startupMs: Long? = null
    private var bufferMs: Long? = null

    fun add(
        dlP2p: Long,
        dlEdge: Long,
        dlBootstrapOrigin: Long,
        dlRelay: Long,
        ul: Long,
        stalls: Long,
        startupMs: Long?,
        bufferMs: Long?,
        peerTimeouts: Long,
        hashFailures: Long,
        peerDisconnects: Long,
        ice: IceConnectivityDelta
    ) {
        this.dlP2p = saturatedAdd(this.dlP2p, dlP2p)
        this.dlEdge = saturatedAdd(this.dlEdge, dlEdge)
        this.dlBootstrapOrigin = saturatedAdd(this.dlBootstrapOrigin, dlBootstrapOrigin)
        this.dlRelay = saturatedAdd(this.dlRelay, dlRelay)
        this.ul = saturatedAdd(this.ul, ul)
        this.stalls = saturatedAdd(this.stalls, stalls)
        this.peerTimeouts = saturatedAdd(this.peerTimeouts, peerTimeouts)
        this.hashFailures = saturatedAdd(this.hashFailures, hashFailures)
        this.peerDisconnects = saturatedAdd(this.peerDisconnects, peerDisconnects)
        iceAttempts = saturatedAdd(iceAttempts, ice.attempts)
        iceSuccesses = saturatedAdd(iceSuccesses, ice.successes)
        iceFailures = saturatedAdd(iceFailures, ice.failures)
        iceCandidateHost = saturatedAdd(iceCandidateHost, ice.hostSuccesses)
        iceCandidateSrflx = saturatedAdd(iceCandidateSrflx, ice.srflxSuccesses)
        iceCandidatePrflx = saturatedAdd(iceCandidatePrflx, ice.prflxSuccesses)
        iceCandidateRelay = saturatedAdd(iceCandidateRelay, ice.relaySuccesses)
        iceCandidateUnknown = saturatedAdd(iceCandidateUnknown, ice.unknownSuccesses)
        if (this.startupMs == null) this.startupMs = startupMs?.coerceAtLeast(0L)
        if (bufferMs != null) this.bufferMs = bufferMs.coerceAtLeast(0L)
    }

    fun incrementJoinTimeout() {
        joinTimeouts = saturatedAdd(joinTimeouts, 1L)
    }

    fun isEmpty(): Boolean = dlP2p == 0L && dlEdge == 0L && dlBootstrapOrigin == 0L &&
        dlRelay == 0L && ul == 0L && stalls == 0L && peerTimeouts == 0L &&
        hashFailures == 0L && peerDisconnects == 0L && joinTimeouts == 0L &&
        iceAttempts == 0L && iceSuccesses == 0L && iceFailures == 0L &&
        iceCandidateHost == 0L && iceCandidateSrflx == 0L && iceCandidatePrflx == 0L &&
        iceCandidateRelay == 0L && iceCandidateUnknown == 0L && startupMs == null && bufferMs == null

    fun toJson() = buildJsonObject {
        put("t", "stats")
        put("dl_p2p", dlP2p)
        put("dl_edge", dlEdge)
        put("dl_bootstrap_origin", dlBootstrapOrigin)
        put("dl_relay", dlRelay)
        put("ul", ul)
        put("stalls", stalls)
        put("peer_timeouts", peerTimeouts)
        put("hash_failures", hashFailures)
        put("peer_disconnects", peerDisconnects)
        put("tracker_join_timeouts", joinTimeouts)
        put("ice_attempts", iceAttempts)
        put("ice_successes", iceSuccesses)
        put("ice_failures", iceFailures)
        put("ice_candidate_host", iceCandidateHost)
        put("ice_candidate_srflx", iceCandidateSrflx)
        put("ice_candidate_prflx", iceCandidatePrflx)
        put("ice_candidate_relay", iceCandidateRelay)
        put("ice_candidate_unknown", iceCandidateUnknown)
        startupMs?.let { put("startup_ms", it) }
        bufferMs?.let { put("buffer_ms", it) }
    }

    fun clear() {
        dlP2p = 0L
        dlEdge = 0L
        dlBootstrapOrigin = 0L
        dlRelay = 0L
        ul = 0L
        stalls = 0L
        peerTimeouts = 0L
        hashFailures = 0L
        peerDisconnects = 0L
        joinTimeouts = 0L
        iceAttempts = 0L
        iceSuccesses = 0L
        iceFailures = 0L
        iceCandidateHost = 0L
        iceCandidateSrflx = 0L
        iceCandidatePrflx = 0L
        iceCandidateRelay = 0L
        iceCandidateUnknown = 0L
        startupMs = null
        bufferMs = null
    }

    private fun saturatedAdd(current: Long, delta: Long): Long {
        val safeDelta = delta.coerceAtLeast(0L)
        return if (Long.MAX_VALUE - current < safeDelta) Long.MAX_VALUE else current + safeDelta
    }
}
