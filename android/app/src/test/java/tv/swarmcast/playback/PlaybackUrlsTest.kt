package tv.swarmcast.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackUrlsTest {
    @Test
    fun authenticatedReplacesTokenAndPreservesOtherQueryParameters() {
        val url = PlaybackUrls.authenticated(
            "https://edge.example.tv/live/seg.m4s?quality=source&token=old",
            "new token"
        )

        assertEquals(
            "https://edge.example.tv/live/seg.m4s?quality=source&token=new%20token",
            url
        )
    }
}
