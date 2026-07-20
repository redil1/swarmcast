package tv.swarmcast.playback

import okhttp3.HttpUrl.Companion.toHttpUrl

data class PlaybackRequest(
    val channelId: String,
    val playlistUrl: String,
    val token: String,
    val playWhenReady: Boolean = true
)

object PlaybackUrls {
    fun authenticated(rawUrl: String, token: String): String {
        require(rawUrl.isNotBlank()) { "playback URL is required" }
        require(token.isNotBlank()) { "playback token is required" }

        return rawUrl.toHttpUrl().newBuilder()
            .removeAllQueryParameters("token")
            .addQueryParameter("token", token)
            .build()
            .toString()
    }

    fun segmentUrl(template: String, fileName: String, token: String): String {
        require(template.contains("{file}")) { "segment template must contain {file}" }
        return authenticated(template.replace("{file}", fileName), token)
    }
}
