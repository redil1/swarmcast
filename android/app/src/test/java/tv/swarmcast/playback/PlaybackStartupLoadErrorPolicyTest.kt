package tv.swarmcast.playback

import androidx.media3.common.C
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PlaybackStartupLoadErrorPolicyTest {
    @Test
    fun `only manifests receive the extended retry count`() {
        val policy = PlaybackStartupLoadErrorPolicy()

        assertEquals(
            PlaybackStartupLoadErrorPolicy.MAX_MANIFEST_RETRIES,
            policy.getMinimumLoadableRetryCount(C.DATA_TYPE_MANIFEST)
        )
        assertEquals(
            DefaultLoadErrorHandlingPolicy().getMinimumLoadableRetryCount(C.DATA_TYPE_MEDIA),
            policy.getMinimumLoadableRetryCount(C.DATA_TYPE_MEDIA)
        )
    }

    @Test
    fun `manifest startup retries use bounded backoff`() {
        assertEquals(1_000L, startupManifestRetryDelayMs(C.DATA_TYPE_MANIFEST, 1))
        assertEquals(3_000L, startupManifestRetryDelayMs(C.DATA_TYPE_MANIFEST, 3))
        assertEquals(3_000L, startupManifestRetryDelayMs(C.DATA_TYPE_MANIFEST, 15))
    }

    @Test
    fun `manifest startup retry stops after the configured bound`() {
        assertNull(startupManifestRetryDelayMs(C.DATA_TYPE_MANIFEST, 16))
    }

    @Test
    fun `non-manifest failures use default Media3 handling`() {
        assertNull(startupManifestRetryDelayMs(C.DATA_TYPE_MEDIA, 1))
    }
}
