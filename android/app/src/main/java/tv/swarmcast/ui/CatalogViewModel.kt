package tv.swarmcast.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import tv.swarmcast.data.CatalogDiskCache
import tv.swarmcast.data.Channel
import tv.swarmcast.data.ChannelRepository
import tv.swarmcast.data.userMessage

class CatalogViewModel(
    private val repository: ChannelRepository,
    private val cache: CatalogDiskCache? = null,
    private val fallbackErrorMessage: String,
    private val pageSize: Int = 100
) : ViewModel() {
    private val _state = MutableStateFlow(CatalogUiState(loading = true))
    val state: StateFlow<CatalogUiState> = _state.asStateFlow()

    private var query = ""
    private var page = 1
    private var hasMore = true
    private var loadJob: Job? = null

    fun search(nextQuery: String) {
        query = nextQuery
        page = 1
        hasMore = true
        _state.update { it.copy(hasMore = true) }
        load(replace = true)
    }

    fun refresh() {
        page = 1
        hasMore = true
        _state.update { it.copy(hasMore = true) }
        load(replace = true)
    }

    fun loadMore() {
        if (_state.value.loading || !_state.value.hasMore) return
        page += 1
        load(replace = false)
    }

    fun select(channel: Channel) {
        _state.update { it.copy(selectedChannel = channel) }
    }

    private fun load(replace: Boolean) {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                if (replace) {
                    val cached = cache?.query(query, pageSize).orEmpty()
                    if (cached.isNotEmpty()) {
                        _state.update { it.copy(channels = cached, loading = true, error = null) }
                    }
                }

                val response = repository.channels(
                    query = query,
                    page = page,
                    pageSize = pageSize
                )
                cache?.upsert(response.items)
                hasMore = response.hasMore
                _state.update { current ->
                    current.copy(
                        channels = if (replace) response.items else current.channels + response.items,
                        hasMore = hasMore,
                        loading = false,
                        error = null
                    )
                }
            } catch (error: Exception) {
                if (!replace) page = (page - 1).coerceAtLeast(1)
                _state.update {
                    it.copy(
                        loading = false,
                        error = error.userMessage(fallbackErrorMessage)
                    )
                }
            }
        }
    }

    companion object {
        fun factory(
            repository: ChannelRepository,
            cache: CatalogDiskCache? = null,
            fallbackErrorMessage: String
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    CatalogViewModel(repository, cache, fallbackErrorMessage) as T
            }
    }
}
