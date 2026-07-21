package tv.swarmcast.p2p

import org.webrtc.RTCStatsReport

data class IceConnectivityDelta(
    val attempts: Long = 0,
    val successes: Long = 0,
    val failures: Long = 0,
    val hostSuccesses: Long = 0,
    val srflxSuccesses: Long = 0,
    val prflxSuccesses: Long = 0,
    val relaySuccesses: Long = 0,
    val unknownSuccesses: Long = 0
)

internal data class IceStat(
    val id: String,
    val type: String,
    val members: Map<String, Any>
)

internal fun selectedIceCandidateType(stats: Collection<IceStat>): String {
    val byId = stats.associateBy(IceStat::id)
    val pairs = stats.filter { stat ->
        stat.type == "candidate-pair" && stat.members["state"] == "succeeded"
    }
    val selected = pairs.firstOrNull { it.members["selected"] == true } ?:
        pairs.firstOrNull { it.members["nominated"] == true } ?:
        pairs.firstOrNull() ?: return "unknown"
    val candidateTypes = listOf("localCandidateId", "remoteCandidateId")
        .mapNotNull { selected.members[it] as? String }
        .mapNotNull(byId::get)
        .mapNotNull { it.members["candidateType"] as? String }
        .toSet()
    return listOf("relay", "srflx", "prflx", "host").firstOrNull(candidateTypes::contains) ?: "unknown"
}

internal fun selectedIceCandidateType(report: RTCStatsReport): String =
    selectedIceCandidateType(report.statsMap.values.map { IceStat(it.id, it.type, it.members) })

internal fun isDirectP2pCandidateType(candidateType: String): Boolean =
    candidateType == "host" || candidateType == "srflx" || candidateType == "prflx"

class IceConnectivityTelemetry {
    private var current = IceConnectivityDelta()
    private var cumulative = IceConnectivityDelta()

    @Synchronized
    fun recordAttempt() {
        current = current.copy(attempts = current.attempts + 1)
        cumulative = cumulative.copy(attempts = cumulative.attempts + 1)
    }

    @Synchronized
    fun recordFailure() {
        current = current.copy(failures = current.failures + 1)
        cumulative = cumulative.copy(failures = cumulative.failures + 1)
    }

    @Synchronized
    fun recordSuccess(candidateType: String) {
        current = when (candidateType) {
            "host" -> current.copy(successes = current.successes + 1, hostSuccesses = current.hostSuccesses + 1)
            "srflx" -> current.copy(successes = current.successes + 1, srflxSuccesses = current.srflxSuccesses + 1)
            "prflx" -> current.copy(successes = current.successes + 1, prflxSuccesses = current.prflxSuccesses + 1)
            "relay" -> current.copy(successes = current.successes + 1, relaySuccesses = current.relaySuccesses + 1)
            else -> current.copy(successes = current.successes + 1, unknownSuccesses = current.unknownSuccesses + 1)
        }
        cumulative = when (candidateType) {
            "host" -> cumulative.copy(successes = cumulative.successes + 1, hostSuccesses = cumulative.hostSuccesses + 1)
            "srflx" -> cumulative.copy(successes = cumulative.successes + 1, srflxSuccesses = cumulative.srflxSuccesses + 1)
            "prflx" -> cumulative.copy(successes = cumulative.successes + 1, prflxSuccesses = cumulative.prflxSuccesses + 1)
            "relay" -> cumulative.copy(successes = cumulative.successes + 1, relaySuccesses = cumulative.relaySuccesses + 1)
            else -> cumulative.copy(successes = cumulative.successes + 1, unknownSuccesses = cumulative.unknownSuccesses + 1)
        }
    }

    @Synchronized
    fun drain(): IceConnectivityDelta = current.also { current = IceConnectivityDelta() }

    @Synchronized
    fun snapshot(): IceConnectivityDelta = cumulative
}
