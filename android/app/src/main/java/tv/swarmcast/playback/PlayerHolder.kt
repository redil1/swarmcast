package tv.swarmcast.playback

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.ui.PlayerView
import tv.swarmcast.p2p.SegmentScheduler

@OptIn(UnstableApi::class)
class PlayerHolder(
    context: Context,
    userAgent: String = "SwarmCast/0.1 Android",
    bufferPolicy: PlaybackBufferPolicy = PlaybackBufferPolicy(),
    scheduler: SegmentScheduler? = null
) {
    private val appContext = context.applicationContext
    private val loadControl = DefaultLoadControl.Builder()
        .setBufferDurationsMs(
            bufferPolicy.minBufferMs,
            bufferPolicy.maxBufferMs,
            bufferPolicy.bufferForPlaybackMs,
            bufferPolicy.bufferForPlaybackAfterRebufferMs
        )
        .build()
    private val httpDataSourceFactory = DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(true)
        .setUserAgent(userAgent)
    private val dataSourceFactory: DataSource.Factory = scheduler?.let {
        SwarmSegmentDataSource.Factory(
            scheduler = it,
            fallbackFactory = httpDataSourceFactory,
            segmentUrgencyMs = bufferPolicy.segmentUrgencyMs
        )
    } ?: httpDataSourceFactory
    private val hlsFactory = HlsMediaSource.Factory(dataSourceFactory)
        .setAllowChunklessPreparation(true)

    val player: ExoPlayer = ExoPlayer.Builder(appContext)
        .setLoadControl(loadControl)
        .build()

    private var startedPlayback = false
    private var lastPlaybackState = Player.STATE_IDLE
    private var rebufferCount = 0

    init {
        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (isPlaying) startedPlayback = true
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (startedPlayback &&
                    playbackState == Player.STATE_BUFFERING &&
                    lastPlaybackState == Player.STATE_READY
                ) {
                    rebufferCount += 1
                }
                if (playbackState == Player.STATE_READY && player.playWhenReady) {
                    startedPlayback = true
                }
                lastPlaybackState = playbackState
            }
        })
    }

    fun attach(view: PlayerView) {
        view.player = player
    }

    fun detach(view: PlayerView) {
        if (view.player === player) view.player = null
    }

    fun play(request: PlaybackRequest) {
        resetPlaybackStats()
        val mediaItem = MediaItem.Builder()
            .setMediaId(request.channelId)
            .setUri(PlaybackUrls.authenticated(request.playlistUrl, request.token))
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .build()

        player.setMediaSource(hlsFactory.createMediaSource(mediaItem))
        player.prepare()
        player.playWhenReady = request.playWhenReady
    }

    fun bufferedDurationMs(): Long =
        (player.bufferedPosition - player.currentPosition).coerceAtLeast(0L)

    fun rebufferCount(): Int = rebufferCount

    fun hasStartedPlayback(): Boolean =
        startedPlayback || player.isPlaying || player.currentPosition > 0L

    fun stop() {
        player.stop()
        player.clearMediaItems()
        resetPlaybackStats()
    }

    fun release() {
        player.release()
    }

    private fun resetPlaybackStats() {
        startedPlayback = false
        lastPlaybackState = Player.STATE_IDLE
        rebufferCount = 0
    }
}
