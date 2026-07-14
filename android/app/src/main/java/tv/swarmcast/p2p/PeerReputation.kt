package tv.swarmcast.p2p

import java.util.concurrent.ConcurrentHashMap

enum class PeerReputationEvent {
    SUCCESS,
    TIMEOUT,
    REJECT,
    HASH_MISMATCH
}

data class PeerReputationSnapshot(
    val peerId: String,
    val score: Int,
    val successes: Int,
    val failures: Int,
    val poisonOffenses: Int,
    val disconnected: Boolean
)

class PeerReputation(
    private val peerId: String,
    private val maxPoisonOffenses: Int = 2,
    private val maxScore: Int = 100,
    private val minScore: Int = -100
) {
    private var score = 0
    private var successes = 0
    private var failures = 0
    private var poisonOffenses = 0
    private var disconnected = false

    @Synchronized
    fun record(event: PeerReputationEvent): PeerReputationSnapshot {
        when (event) {
            PeerReputationEvent.SUCCESS -> {
                successes += 1
                score = (score + 3).coerceAtMost(maxScore)
            }
            PeerReputationEvent.REJECT -> {
                failures += 1
                score = (score - 1).coerceAtLeast(minScore)
            }
            PeerReputationEvent.TIMEOUT -> {
                failures += 1
                score = (score - 3).coerceAtLeast(minScore)
            }
            PeerReputationEvent.HASH_MISMATCH -> {
                failures += 1
                poisonOffenses += 1
                score = (score - 25).coerceAtLeast(minScore)
                if (poisonOffenses >= maxPoisonOffenses) disconnected = true
            }
        }
        return snapshot()
    }

    @Synchronized
    fun snapshot(): PeerReputationSnapshot =
        PeerReputationSnapshot(
            peerId = peerId,
            score = score,
            successes = successes,
            failures = failures,
            poisonOffenses = poisonOffenses,
            disconnected = disconnected
        )
}

class PeerReputationBook(
    private val maxPoisonOffenses: Int = 2,
    private val maxScore: Int = 100,
    private val minScore: Int = -100
) {
    private val peers = ConcurrentHashMap<String, PeerReputation>()

    fun get(peerId: String): PeerReputation =
        peers.computeIfAbsent(peerId) {
            PeerReputation(
                peerId = it,
                maxPoisonOffenses = maxPoisonOffenses,
                maxScore = maxScore,
                minScore = minScore
            )
        }

    fun record(peerId: String, event: PeerReputationEvent): PeerReputationSnapshot =
        get(peerId).record(event)

    fun score(peerId: String): Int = get(peerId).snapshot().score

    fun isDisconnected(peerId: String): Boolean = get(peerId).snapshot().disconnected

    fun candidates(): List<PeerReputationSnapshot> =
        peers.values
            .map { it.snapshot() }
            .filterNot { it.disconnected }
            .sortedByDescending { it.score }
}
