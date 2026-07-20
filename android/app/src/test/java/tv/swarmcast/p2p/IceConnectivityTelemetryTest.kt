package tv.swarmcast.p2p

import org.junit.Assert.assertEquals
import org.junit.Test

class IceConnectivityTelemetryTest {
    @Test
    fun classifiesSelectedCandidatePairAndRelayTakesPrecedence() {
        val stats = listOf(
            IceStat("pair", "candidate-pair", mapOf("state" to "succeeded", "nominated" to true, "localCandidateId" to "local", "remoteCandidateId" to "remote")),
            IceStat("local", "local-candidate", mapOf("candidateType" to "srflx")),
            IceStat("remote", "remote-candidate", mapOf("candidateType" to "relay"))
        )

        assertEquals("relay", selectedIceCandidateType(stats))
    }

    @Test
    fun drainsAttemptOutcomesExactlyOnce() {
        val telemetry = IceConnectivityTelemetry()
        telemetry.recordAttempt()
        telemetry.recordAttempt()
        telemetry.recordSuccess("srflx")
        telemetry.recordFailure()

        assertEquals(IceConnectivityDelta(attempts = 2, successes = 1, failures = 1, srflxSuccesses = 1), telemetry.drain())
        assertEquals(IceConnectivityDelta(), telemetry.drain())
    }

    @Test
    fun onlyNonRelaySelectedCandidatesCountAsDirectP2p() {
        assertEquals(true, isDirectP2pCandidateType("host"))
        assertEquals(true, isDirectP2pCandidateType("srflx"))
        assertEquals(true, isDirectP2pCandidateType("prflx"))
        assertEquals(false, isDirectP2pCandidateType("relay"))
        assertEquals(false, isDirectP2pCandidateType("unknown"))
    }
}
