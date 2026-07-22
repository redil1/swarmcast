package tv.swarmcast.playback

import androidx.media3.exoplayer.source.BehindLiveWindowException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.swarmcast.data.ErrorCodes
import tv.swarmcast.data.SwarmCastApiException
import java.io.IOException

class PlayerErrorRecoveryTest {
    @Test
    fun detectsNestedBehindLiveWindowFailure() {
        val error = IOException("source failed", BehindLiveWindowException())

        assertTrue(error.requiresLiveEdgeRecovery())
    }

    @Test
    fun recoversWhenADeletedLiveSegmentReturnsNotFound() {
        val error = IOException(
            "segment fetch failed",
            SwarmCastApiException(ErrorCodes.EDGE_UNAVAILABLE, httpStatus = 404)
        )

        assertTrue(error.requiresLiveEdgeRecovery())
    }

    @Test
    fun doesNotTreatOtherSourceFailuresAsLiveWindowFailures() {
        assertFalse(IOException("network unavailable").requiresLiveEdgeRecovery())
        assertFalse(
            SwarmCastApiException(ErrorCodes.EDGE_UNAVAILABLE, httpStatus = 503)
                .requiresLiveEdgeRecovery()
        )
    }
}
