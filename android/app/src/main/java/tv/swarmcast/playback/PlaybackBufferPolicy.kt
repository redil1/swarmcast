package tv.swarmcast.playback

data class PlaybackBufferPolicy(
    val minBufferMs: Int = 30_000,
    val maxBufferMs: Int = 60_000,
    val bufferForPlaybackMs: Int = 2_500,
    val bufferForPlaybackAfterRebufferMs: Int = 5_000,
    val segmentUrgencyMs: Long = 1_500,
    val liveTargetOffsetMs: Long = 2_000
) {
    init {
        require(minBufferMs > 0) { "minBufferMs must be positive" }
        require(maxBufferMs >= minBufferMs) { "maxBufferMs must be at least minBufferMs" }
        require(bufferForPlaybackMs > 0) { "bufferForPlaybackMs must be positive" }
        require(bufferForPlaybackAfterRebufferMs >= bufferForPlaybackMs) {
            "bufferForPlaybackAfterRebufferMs must be at least bufferForPlaybackMs"
        }
        require(liveTargetOffsetMs >= 0L) { "liveTargetOffsetMs must not be negative" }
    }
}
