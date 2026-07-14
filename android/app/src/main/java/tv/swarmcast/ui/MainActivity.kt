package tv.swarmcast.ui

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import okhttp3.Cache
import okhttp3.OkHttpClient
import tv.swarmcast.R
import tv.swarmcast.data.AppConfig
import tv.swarmcast.data.AuthRepository
import tv.swarmcast.data.CatalogDiskCache
import tv.swarmcast.data.Channel
import tv.swarmcast.data.ChannelRepository
import tv.swarmcast.data.NetworkPolicy
import tv.swarmcast.p2p.SegmentScheduler
import tv.swarmcast.p2p.SegmentStore
import tv.swarmcast.p2p.RlncCodec
import tv.swarmcast.p2p.TrackerClient
import tv.swarmcast.playback.PlaybackSessionCoordinator
import tv.swarmcast.playback.PlayerHolder
import java.io.File

class MainActivity : ComponentActivity() {
    private val appConfig by lazy { AppConfig.from(this) }
    private val httpClient by lazy {
        OkHttpClient.Builder()
            .cache(Cache(File(cacheDir, HTTP_CACHE_DIR), HTTP_CACHE_BYTES))
            .build()
    }
    private val catalogViewModel: CatalogViewModel by viewModels {
        CatalogViewModel.factory(
            repository = ChannelRepository(appConfig.apiBase, http = httpClient),
            cache = CatalogDiskCache(this),
            fallbackErrorMessage = getString(R.string.catalog_request_failed)
        )
    }
    private var playbackSession: PlaybackSessionCoordinator? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        )
        catalogViewModel.refresh()
        setContent {
            var query by rememberSaveable { mutableStateOf("") }
            var p2pEnabled by rememberSaveable { mutableStateOf(appConfig.featureFlags.initialP2pEnabled) }
            var activePlayerHolder by remember { mutableStateOf<PlayerHolder?>(null) }
            val catalogState by catalogViewModel.state.collectAsState()
            val p2pToggleAllowed = appConfig.featureFlags.p2pToggleAllowed
            LaunchedEffect(p2pToggleAllowed) {
                if (!p2pToggleAllowed && p2pEnabled) {
                    p2pEnabled = false
                    playbackSession?.setP2pEnabled(false)
                }
            }

            MaterialTheme {
                Surface {
                    SwarmCastScreen(
                        state = catalogState,
                        query = query,
                        p2pEnabled = p2pEnabled,
                        p2pToggleEnabled = p2pToggleAllowed,
                        onQueryChange = {
                            query = it
                            catalogViewModel.search(it)
                        },
                        onP2pEnabledChange = {
                            val next = it && p2pToggleAllowed
                            p2pEnabled = next
                            playbackSession?.setP2pEnabled(next)
                        },
                        onRefresh = { catalogViewModel.refresh() },
                        onLoadMore = { catalogViewModel.loadMore() },
                        onChannelSelected = {
                            catalogViewModel.select(it)
                            activePlayerHolder = startPlayback(it, p2pEnabled && p2pToggleAllowed)
                        },
                        playerHolder = activePlayerHolder
                    )
                }
            }
        }
    }

    override fun onDestroy() {
        playbackSession?.release()
        playbackSession = null
        super.onDestroy()
    }

    private fun startPlayback(channel: Channel, p2pEnabled: Boolean): PlayerHolder {
        playbackSession?.release()

        val store = SegmentStore()
        val scheduler = SegmentScheduler(
            store,
            http = httpClient,
            decoderFactory = if (appConfig.featureFlags.rlncEnabled) {
                RlncCodec.decoderFactory
            } else {
                tv.swarmcast.p2p.NetworkCodingDecoderFactory.Disabled
            },
            encoderFactory = if (appConfig.featureFlags.rlncEnabled) {
                RlncCodec.encoderFactory
            } else {
                tv.swarmcast.p2p.NetworkCodingEncoderFactory.Disabled
            }
        )
        val authRepository = AuthRepository(
            apiBase = appConfig.apiBase,
            appApiKey = appConfig.appApiKey,
            http = httpClient
        )
        val tracker = TrackerClient(
            initialWsUrl = appConfig.trackerWsUrl,
            tokenProvider = suspend { authRepository.token() },
            scope = lifecycleScope
        )
        val playerHolder = PlayerHolder(this, scheduler = scheduler)
        val session = PlaybackSessionCoordinator(
            context = this,
            channelId = channel.id,
            authRepository = authRepository,
            tracker = tracker,
            playerHolder = playerHolder,
            scheduler = scheduler,
            store = store,
            networkPolicy = NetworkPolicy(this),
            scope = lifecycleScope
        )
        session.setP2pEnabled(p2pEnabled && appConfig.featureFlags.p2pToggleAllowed)
        playbackSession = session
        lifecycleScope.launch { session.start() }
        return playerHolder
    }

    companion object {
        private const val HTTP_CACHE_DIR = "swarmcast-http-cache"
        private const val HTTP_CACHE_BYTES = 32L * 1024L * 1024L
    }
}
