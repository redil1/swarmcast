package tv.swarmcast.diagnostics

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import tv.swarmcast.data.NetworkPolicySnapshot
import tv.swarmcast.p2p.IceConnectivityDelta
import tv.swarmcast.p2p.SchedulerStats
import java.util.Base64
import java.util.concurrent.atomic.AtomicReference

data class DeviceLabSnapshot(
    val capturedAtElapsedRealtimeMs: Long,
    val channelId: String,
    val p2pEnabled: Boolean,
    val p2pDownloadAllowed: Boolean,
    val uploadAllowed: Boolean,
    val swarmMode: String,
    val network: NetworkPolicySnapshot,
    val activePeerLinks: Int,
    val playbackStarted: Boolean,
    val rebufferCount: Int,
    val bufferMs: Long,
    val scheduler: SchedulerStats,
    val ice: IceConnectivityDelta
) {
    fun toJson(): String = buildJsonObject {
        put("schemaVersion", SCHEMA_VERSION)
        put("capturedAtElapsedRealtimeMs", capturedAtElapsedRealtimeMs)
        put("channelId", channelId)
        put("p2pEnabled", p2pEnabled)
        put("p2pDownloadAllowed", p2pDownloadAllowed)
        put("uploadAllowed", uploadAllowed)
        put("swarmMode", swarmMode)
        put("networkClass", network.transport)
        put("metered", network.metered)
        put("batteryPercent", network.batteryPercent)
        put("charging", network.charging)
        put("uplinkKbps", network.uplinkKbps)
        put("activePeerLinks", activePeerLinks)
        put("playbackStarted", playbackStarted)
        put("rebufferCount", rebufferCount)
        put("bufferMs", bufferMs)
        put("downloadedFromPeers", scheduler.downloadedFromPeers)
        put("downloadedFromEdge", scheduler.downloadedFromEdge)
        put("downloadedFromBootstrapOrigin", scheduler.downloadedFromBootstrapOrigin)
        put("downloadedFromRelay", scheduler.downloadedFromRelay)
        put("uploadedToPeers", scheduler.uploadedToPeers)
        put("peerTimeouts", scheduler.peerTimeouts)
        put("peerHashFailures", scheduler.peerHashFailures)
        put("peerDisconnects", scheduler.peerDisconnects)
        put("iceAttempts", ice.attempts)
        put("iceSuccesses", ice.successes)
        put("iceFailures", ice.failures)
        put("iceCandidateHost", ice.hostSuccesses)
        put("iceCandidateSrflx", ice.srflxSuccesses)
        put("iceCandidatePrflx", ice.prflxSuccesses)
        put("iceCandidateRelay", ice.relaySuccesses)
        put("iceCandidateUnknown", ice.unknownSuccesses)
    }.toString()

    fun toWireValue(): String = WIRE_PREFIX + Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(toJson().toByteArray(Charsets.UTF_8))

    companion object {
        const val SCHEMA_VERSION = 1
        const val WIRE_PREFIX = "scdl1:"
    }
}

object DeviceLabDiagnostics {
    private data class Registration(
        val owner: Any,
        val snapshot: () -> DeviceLabSnapshot,
        val setP2pEnabled: (Boolean) -> Unit
    )

    private val active = AtomicReference<Registration?>(null)

    fun register(
        owner: Any,
        snapshot: () -> DeviceLabSnapshot,
        setP2pEnabled: (Boolean) -> Unit
    ) {
        active.set(Registration(owner, snapshot, setP2pEnabled))
    }

    fun unregister(owner: Any) {
        active.updateAndGet { registration ->
            if (registration?.owner === owner) null else registration
        }
    }

    fun snapshot(): DeviceLabSnapshot? = active.get()?.snapshot?.invoke()

    fun setP2pEnabled(enabled: Boolean): DeviceLabSnapshot? {
        val registration = active.get() ?: return null
        registration.setP2pEnabled(enabled)
        return registration.snapshot()
    }
}
