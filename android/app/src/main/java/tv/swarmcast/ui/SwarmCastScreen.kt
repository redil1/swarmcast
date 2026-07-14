package tv.swarmcast.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.media3.ui.PlayerView
import tv.swarmcast.R
import tv.swarmcast.data.Channel
import tv.swarmcast.playback.PlayerHolder

data class CatalogUiState(
    val channels: List<Channel> = emptyList(),
    val selectedChannel: Channel? = null,
    val hasMore: Boolean = true,
    val loading: Boolean = false,
    val error: String? = null
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SwarmCastScreen(
    state: CatalogUiState,
    query: String,
    p2pEnabled: Boolean,
    p2pToggleEnabled: Boolean = true,
    onQueryChange: (String) -> Unit,
    onP2pEnabledChange: (Boolean) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onChannelSelected: (Channel) -> Unit,
    playerHolder: PlayerHolder? = null,
    modifier: Modifier = Modifier
) {
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(R.string.app_name)) })
        },
        modifier = modifier
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            SearchAndPolicyRow(
                query = query,
                p2pEnabled = p2pEnabled,
                p2pToggleEnabled = p2pToggleEnabled,
                onQueryChange = onQueryChange,
                onP2pEnabledChange = onP2pEnabledChange,
                onRefresh = onRefresh
            )

            state.selectedChannel?.let {
                PlayerPanel(channel = it, p2pEnabled = p2pEnabled, playerHolder = playerHolder)
            }

            if (state.error != null) {
                Text(
                    text = state.error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive }
                )
            }

            ChannelList(
                channels = state.channels,
                loading = state.loading,
                hasMore = state.hasMore,
                onLoadMore = onLoadMore,
                onChannelSelected = onChannelSelected,
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun SearchAndPolicyRow(
    query: String,
    p2pEnabled: Boolean,
    p2pToggleEnabled: Boolean,
    onQueryChange: (String) -> Unit,
    onP2pEnabledChange: (Boolean) -> Unit,
    onRefresh: () -> Unit
) {
    var showPrivacy by rememberSaveable { mutableStateOf(false) }
    val p2pState = if (p2pEnabled) {
        stringResource(R.string.p2p_enabled_state)
    } else {
        stringResource(R.string.p2p_disabled_state)
    }

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                label = { Text(stringResource(R.string.search_label)) },
                singleLine = true,
                modifier = Modifier.weight(1f)
            )
            Button(onClick = onRefresh) {
                Text(stringResource(R.string.refresh_action))
            }
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column {
                Text(
                    stringResource(R.string.p2p_upload_label),
                    style = MaterialTheme.typography.bodyMedium
                )
                TextButton(onClick = { showPrivacy = true }) {
                    Text(stringResource(R.string.privacy_action))
                }
            }
            Switch(
                checked = p2pEnabled,
                onCheckedChange = onP2pEnabledChange,
                enabled = p2pToggleEnabled,
                modifier = Modifier.semantics {
                    contentDescription = p2pState
                    stateDescription = p2pState
                }
            )
        }
    }

    if (showPrivacy) {
        AlertDialog(
            onDismissRequest = { showPrivacy = false },
            confirmButton = {
                TextButton(onClick = { showPrivacy = false }) {
                    Text(stringResource(R.string.privacy_done))
                }
            },
            title = { Text(stringResource(R.string.privacy_title)) },
            text = {
                Text(stringResource(R.string.privacy_body))
            }
        )
    }
}

@Composable
private fun PlayerPanel(channel: Channel, p2pEnabled: Boolean, playerHolder: PlayerHolder?) {
    val playerDescription = stringResource(R.string.player_content_description, channel.name)
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.small,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (playerHolder != null) {
                AndroidView(
                    factory = { context ->
                        PlayerView(context).apply { player = playerHolder.player }
                    },
                    update = { view -> view.player = playerHolder.player },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp)
                        .semantics { contentDescription = playerDescription }
                )
            }
            Text(
                text = channel.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() }
            )
            Text(
                text = if (p2pEnabled) {
                    stringResource(R.string.player_state_peer_on)
                } else {
                    stringResource(R.string.player_state_delivery_only)
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun ChannelList(
    channels: List<Channel>,
    loading: Boolean,
    hasMore: Boolean,
    onLoadMore: () -> Unit,
    onChannelSelected: (Channel) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(modifier = modifier.fillMaxWidth()) {
        if (loading && channels.isEmpty()) {
            item(key = "loading") {
                Text(
                    text = stringResource(R.string.loading_channels),
                    modifier = Modifier
                        .padding(vertical = 16.dp)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }

        if (!loading && channels.isEmpty()) {
            item(key = "empty") {
                Text(
                    text = stringResource(R.string.no_channels),
                    modifier = Modifier.padding(vertical = 16.dp),
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }

        items(items = channels, key = { it.id }) { channel ->
            ChannelRow(channel = channel, onClick = { onChannelSelected(channel) })
            HorizontalDivider()
        }

        if (channels.isNotEmpty() && loading) {
            item(key = "loading-more") {
                Text(
                    text = stringResource(R.string.loading_more_channels),
                    modifier = Modifier
                        .padding(vertical = 16.dp)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }

        if (channels.isNotEmpty() && hasMore && !loading) {
            item(key = "load-more") {
                TextButton(
                    onClick = onLoadMore,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp)
                ) {
                    Text(stringResource(R.string.load_more_action))
                }
            }
        }
    }
}

@Composable
private fun ChannelRow(channel: Channel, onClick: () -> Unit) {
    val unknownGroup = stringResource(R.string.unknown_group)
    val groupLabel = channel.group.ifBlank { unknownGroup }
    val channelDescription = stringResource(R.string.channel_row_content_description, channel.name, groupLabel)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 12.dp)
            .semantics { contentDescription = channelDescription },
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Text(
            text = channel.name,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (channel.group.isNotBlank()) {
                Text(
                    text = channel.group,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (channel.tvgId.isNotBlank()) {
                Text(
                    text = channel.tvgId,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        Spacer(modifier = Modifier.height(2.dp))
    }
}
