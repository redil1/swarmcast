package tv.swarmcast.playback

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy

@OptIn(UnstableApi::class)
internal class PlaybackStartupLoadErrorPolicy : DefaultLoadErrorHandlingPolicy() {
    override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
        return startupManifestRetryDelayMs(
            dataType = loadErrorInfo.mediaLoadData.dataType,
            errorCount = loadErrorInfo.errorCount
        ) ?: super.getRetryDelayMsFor(loadErrorInfo)
    }

    override fun getMinimumLoadableRetryCount(dataType: Int): Int =
        if (dataType == C.DATA_TYPE_MANIFEST) {
            MAX_MANIFEST_RETRIES
        } else {
            super.getMinimumLoadableRetryCount(dataType)
        }

    companion object {
        internal const val MAX_MANIFEST_RETRIES = 15
    }
}

@OptIn(UnstableApi::class)
internal fun startupManifestRetryDelayMs(dataType: Int, errorCount: Int): Long? {
    if (dataType != C.DATA_TYPE_MANIFEST || errorCount !in 1..PlaybackStartupLoadErrorPolicy.MAX_MANIFEST_RETRIES) {
        return null
    }
    return (errorCount * 1_000L).coerceAtMost(3_000L)
}
