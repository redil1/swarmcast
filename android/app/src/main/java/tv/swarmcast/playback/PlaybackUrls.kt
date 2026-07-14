package tv.swarmcast.playback

import android.net.Uri

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

        val uri = Uri.parse(rawUrl)
        val builder = uri.buildUpon().clearQuery()
        uri.queryParameterNames
            .filterNot { it == "token" }
            .forEach { name ->
                uri.getQueryParameters(name).forEach { value ->
                    builder.appendQueryParameter(name, value)
                }
            }
        return builder.appendQueryParameter("token", token).build().toString()
    }

    fun segmentUrl(template: String, fileName: String, token: String): String {
        require(template.contains("{file}")) { "segment template must contain {file}" }
        return authenticated(template.replace("{file}", fileName), token)
    }
}
