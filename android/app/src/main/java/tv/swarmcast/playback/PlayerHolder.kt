package tv.swarmcast.playback

import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.BehindLiveWindowException
import androidx.media3.ui.PlayerView
import tv.swarmcast.data.ErrorCodes
import tv.swarmcast.data.SwarmCastApiException
import tv.swarmcast.p2p.SegmentScheduler

@OptIn(UnstableApi::class)
internal fun Throwable.requiresLiveEdgeRecovery(): Boolean =
    generateSequence(this as Throwable?) { it.cause }
        .any {
            it is BehindLiveWindowException ||
                (it is SwarmCastApiException &&
                    it.code == ErrorCodes.EDGE_UNAVAILABLE &&
                    it.httpStatus == 404)
        }

@OptIn(UnstableApi::class)
class PlayerHolder(
    context: Context,
    userAgent: String = "SwarmCast/0.1 Android",
    private val bufferPolicy: PlaybackBufferPolicy = PlaybackBufferPolicy(),
    private val scheduler: SegmentScheduler? = null
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
    val player: ExoPlayer = ExoPlayer.Builder(appContext)
        .setLoadControl(loadControl)
        .build()

    private var startedPlayback = false
    private var lastPlaybackState = Player.STATE_IDLE
    private var rebufferCount = 0
    private var consecutiveLiveRecoveryAttempts = 0

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
                    consecutiveLiveRecoveryAttempts = 0
                }
                lastPlaybackState = playbackState
            }

            override fun onPlayerError(error: PlaybackException) {
                if (error.requiresLiveEdgeRecovery() &&
                    consecutiveLiveRecoveryAttempts < MAX_CONSECUTIVE_LIVE_RECOVERIES
                ) {
                    consecutiveLiveRecoveryAttempts += 1
                    player.seekToDefaultPosition()
                    player.prepare()
                }
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
        val authenticatedHttpFactory = ResolvingDataSource.Factory(httpDataSourceFactory) { dataSpec ->
            dataSpec.withUri(
                Uri.parse(PlaybackUrls.authenticated(dataSpec.uri.toString(), request.token))
            )
        }
        val dataSourceFactory: DataSource.Factory = scheduler?.let {
            SwarmSegmentDataSource.Factory(
                scheduler = it,
                fallbackFactory = authenticatedHttpFactory,
                segmentUrgencyMs = bufferPolicy.segmentUrgencyMs
            )
        } ?: authenticatedHttpFactory
        val hlsFactory = HlsMediaSource.Factory(dataSourceFactory)
            .setAllowChunklessPreparation(true)
            .setLoadErrorHandlingPolicy(PlaybackStartupLoadErrorPolicy())
        val mediaItem = MediaItem.Builder()
            .setMediaId(request.channelId)
            .setUri(PlaybackUrls.authenticated(request.playlistUrl, request.token))
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .setLiveConfiguration(
                MediaItem.LiveConfiguration.Builder()
                    .setTargetOffsetMs(bufferPolicy.liveTargetOffsetMs)
                    .build()
            )
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
        consecutiveLiveRecoveryAttempts = 0
    }

    private companion object {
        const val MAX_CONSECUTIVE_LIVE_RECOVERIES = 3
    }
}
