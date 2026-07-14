package tv.swarmcast.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

class ChannelRepository(
    private val apiBase: String,
    private val http: OkHttpClient = OkHttpClient(),
    private val json: Json = Json { ignoreUnknownKeys = true }
) {
    suspend fun channels(
        query: String = "",
        group: String = "",
        page: Int = 1,
        pageSize: Int = 50
    ): ChannelPage = withContext(Dispatchers.IO) {
        val url = buildString {
            append("$apiBase/channels?page=")
            append(page)
            append("&pageSize=")
            append(pageSize)
            if (query.isNotBlank()) append("&q=").append(query.urlComponent())
            if (group.isNotBlank()) append("&group=").append(group.urlComponent())
        }
        val request = Request.Builder().url(url).build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw apiExceptionFromResponse(json, response.body?.string(), response.code)
            }
            json.decodeFromString<ChannelPage>(response.body?.string() ?: error("empty channel response"))
        }
    }

    suspend fun groups(): GroupsResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("$apiBase/groups").build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw apiExceptionFromResponse(json, response.body?.string(), response.code)
            }
            json.decodeFromString<GroupsResponse>(response.body?.string() ?: error("empty groups response"))
        }
    }

    private fun String.urlComponent(): String =
        java.net.URLEncoder.encode(this, Charsets.UTF_8.name())
}

@Serializable
data class Channel(
    val id: String,
    val name: String,
    val logo: String = "",
    val group: String = "",
    val tvgId: String = ""
)

@Serializable
data class ChannelPage(
    val items: List<Channel>,
    val page: Int,
    val pageSize: Int,
    val total: Int,
    val hasMore: Boolean
)

@Serializable
data class GroupsResponse(
    val groups: List<String>
)
