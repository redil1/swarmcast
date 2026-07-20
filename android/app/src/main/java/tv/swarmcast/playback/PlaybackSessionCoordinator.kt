package tv.swarmcast.playback

import android.content.Context
import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import tv.swarmcast.data.AuthRepository
import tv.swarmcast.data.NetworkPolicy
import tv.swarmcast.data.p2pPermissions
import tv.swarmcast.p2p.PeerConnectionManager
import tv.swarmcast.p2p.PeerInfo
import tv.swarmcast.p2p.PeerLink
import tv.swarmcast.p2p.SchedulerStats
import tv.swarmcast.p2p.SegmentScheduler
import tv.swarmcast.p2p.SegmentStore
import tv.swarmcast.p2p.TrackerClient
import tv.swarmcast.p2p.TrackerEvent
import tv.swarmcast.p2p.UploadBudget

class PlaybackSessionCoordinator(
    context: Context,
    private val channelId: String,
    private val authRepository: AuthRepository,
    private val tracker: TrackerClient,
    private val playerHolder: PlayerHolder,
    private val scheduler: SegmentScheduler,
    private val store: SegmentStore,
    private val networkPolicy: NetworkPolicy,
    private val scope: CoroutineScope,
    private val uploadBudget: UploadBudget = UploadBudget()
) {
    private val peerManager = PeerConnectionManager(
        context = context,
        tracker = tracker,
        onOpen = { peerId, channel, closePeer ->
            scheduler.addLink(
                PeerLink(
                    peerId = peerId,
                    channel = channel,
                    store = store,
                    uploadBudget = uploadBudget,
                    scope = scope,
                    uploadAllowed = { uploadAllowed },
                    codedPacketProvider = scheduler::codedPacket,
                    onClosed = { closePeer() },
                    onUploaded = { _, bytes -> scheduler.recordUploaded(bytes) }
                )
            )
        },
        onClosed = { peerId -> scheduler.removeLink(peerId) },
        onCapacityAvailable = { peerIds -> schedulePeerReplenishment(peerIds) }
    )

    private var eventsJob: Job? = null
    private var statsJob: Job? = null
    private var token: String = ""
    private var p2pEnabled = true
    private var p2pDownloadAllowed = false
    private var uploadAllowed = false
    private var swarmMode = "edge-only"
    private var peerRefreshJob: Job? = null
    private var lastStats = SchedulerStats(downloadedFromPeers = 0, downloadedFromEdge = 0)
    private var lastStalls = 0
    private var playbackStartMs = 0L
    private var startupLatencyReported = false

    suspend fun start() {
        stop()
        token = authRepository.token()
        val networkSnapshot = networkPolicy.snapshot()
        val permissions = p2pPermissions(p2pEnabled, networkSnapshot)
        p2pDownloadAllowed = permissions.downloadAllowed
        uploadAllowed = permissions.uploadAllowed

        eventsJob = scope.launch {
            tracker.events.collect { handleTrackerEvent(it) }
        }
        statsJob = scope.launch {
            while (isActive) {
                delay(STATS_FLUSH_MS)
                flushStats()
            }
        }

        tracker.connect(
            channelId = channelId,
            wifi = networkSnapshot.transport == "wifi" && !networkSnapshot.metered,
            uploadEnabled = uploadAllowed,
            uplinkKbps = networkSnapshot.uplinkKbps
        )
    }

    fun setP2pEnabled(enabled: Boolean) {
        p2pEnabled = enabled
        val snapshot = networkPolicy.snapshot()
        val permissions = p2pPermissions(enabled, snapshot)
        p2pDownloadAllowed = permissions.downloadAllowed
        uploadAllowed = permissions.uploadAllowed
        if (!p2pDownloadAllowed) {
            peerRefreshJob?.cancel()
            peerManager.closeAll()
        } else if (swarmMode == "p2p") {
            schedulePeerReplenishment(peerManager.peerIds, immediate = true)
        }
    }

    fun stop() {
        eventsJob?.cancel()
        statsJob?.cancel()
        peerRefreshJob?.cancel()
        eventsJob = null
        statsJob = null
        peerRefreshJob = null
        p2pDownloadAllowed = false
        uploadAllowed = false
        peerManager.closeAll()
        tracker.close()
        playerHolder.stop()
        lastStats = SchedulerStats(downloadedFromPeers = 0, downloadedFromEdge = 0)
        lastStalls = 0
        playbackStartMs = 0L
        startupLatencyReported = false
    }

    fun release() {
        stop()
        playerHolder.release()
    }

    private fun handleTrackerEvent(event: TrackerEvent) {
        when (event) {
            is TrackerEvent.Joined -> {
                swarmMode = event.swarmMode
                scheduler.configure(event, token)
                playbackStartMs = SystemClock.elapsedRealtime()
                startupLatencyReported = false
                playerHolder.play(
                    PlaybackRequest(
                        channelId = channelId,
                        playlistUrl = event.playlistUrl,
                        token = token
                    )
                )
            }
            is TrackerEvent.Peers -> {
                if (p2pDownloadAllowed && swarmMode != "edge-only") {
                    event.peers.forEach(::connectPeer)
                    schedulePeerReplenishment(peerManager.peerIds)
                }
            }
            is TrackerEvent.Signal -> {
                if (p2pDownloadAllowed && swarmMode != "edge-only") {
                    peerManager.onSignal(event)
                }
            }
            is TrackerEvent.SwarmMode -> {
                swarmMode = event.swarmMode
                if (swarmMode == "edge-only") {
                    peerRefreshJob?.cancel()
                    peerManager.closeAll()
                } else if (p2pDownloadAllowed) {
                    schedulePeerReplenishment(peerManager.peerIds, immediate = true)
                }
            }
            is TrackerEvent.Segment -> scheduler.onSegmentAnnounce(event)
            is TrackerEvent.Redirect -> Unit
            is TrackerEvent.Error -> Unit
            TrackerEvent.Disconnected -> peerManager.closeAll()
        }
    }

    private fun connectPeer(peer: PeerInfo) {
        if (peer.id.isNotBlank()) peerManager.connectTo(peer)
    }

    private fun schedulePeerReplenishment(peerIds: Set<String>, immediate: Boolean = false) {
        if (!p2pDownloadAllowed || swarmMode != "p2p" || peerIds.size >= TARGET_PEERS) return
        peerRefreshJob?.cancel()
        peerRefreshJob = scope.launch {
            if (!immediate) delay(PEER_REFRESH_DELAY_MS)
            tracker.requestPeers(peerIds)
        }
    }

    private fun flushStats() {
        val current = scheduler.stats()
        val currentStalls = playerHolder.rebufferCount()
        val startupMs = if (!startupLatencyReported &&
            playbackStartMs > 0L &&
            playerHolder.hasStartedPlayback()
        ) {
            startupLatencyReported = true
            SystemClock.elapsedRealtime() - playbackStartMs
        } else {
            null
        }
        tracker.reportStats(
            dlP2p = current.downloadedFromPeers - lastStats.downloadedFromPeers,
            dlEdge = current.downloadedFromEdge - lastStats.downloadedFromEdge,
            dlBootstrapOrigin = current.downloadedFromBootstrapOrigin - lastStats.downloadedFromBootstrapOrigin,
            dlRelay = current.downloadedFromRelay - lastStats.downloadedFromRelay,
            ul = current.uploadedToPeers - lastStats.uploadedToPeers,
            stalls = (currentStalls - lastStalls).coerceAtLeast(0),
            startupMs = startupMs,
            bufferMs = playerHolder.bufferedDurationMs(),
            peerTimeouts = current.peerTimeouts - lastStats.peerTimeouts,
            hashFailures = current.peerHashFailures - lastStats.peerHashFailures,
            peerDisconnects = current.peerDisconnects - lastStats.peerDisconnects
        )
        lastStats = current
        lastStalls = currentStalls
    }

    companion object {
        private const val STATS_FLUSH_MS = 10_000L
        private const val PEER_REFRESH_DELAY_MS = 5_000L
        private const val TARGET_PEERS = 12
    }
}
