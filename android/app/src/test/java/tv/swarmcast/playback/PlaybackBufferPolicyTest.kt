package tv.swarmcast.playback

import org.junit.Assert.assertThrows
import org.junit.Test

class PlaybackBufferPolicyTest {
    @Test
    fun rejectsNegativeLiveTargetOffset() {
        assertThrows(IllegalArgumentException::class.java) {
            PlaybackBufferPolicy(liveTargetOffsetMs = -1)
        }
    }
}
