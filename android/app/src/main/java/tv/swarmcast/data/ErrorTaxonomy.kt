package tv.swarmcast.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

object ErrorCodes {
    const val CAPACITY = "capacity"
    const val NOT_FOUND = "not_found"
    const val UNKNOWN_CHANNEL = "unknown_channel"
    const val UNAUTHORIZED = "unauthorized"
    const val SOURCE_UNAVAILABLE = "source_unavailable"
    const val EDGE_UNAVAILABLE = "edge_unavailable"
    const val TRACKER_UNAVAILABLE = "tracker_unavailable"
    const val RATE_LIMITED = "rate_limited"
    const val CONFIG_INVALID = "config_invalid"
}

private val allCodes = setOf(
    ErrorCodes.CAPACITY,
    ErrorCodes.NOT_FOUND,
    ErrorCodes.UNKNOWN_CHANNEL,
    ErrorCodes.UNAUTHORIZED,
    ErrorCodes.SOURCE_UNAVAILABLE,
    ErrorCodes.EDGE_UNAVAILABLE,
    ErrorCodes.TRACKER_UNAVAILABLE,
    ErrorCodes.RATE_LIMITED,
    ErrorCodes.CONFIG_INVALID
)

private val clientVisibleCodes = setOf(
    ErrorCodes.CAPACITY,
    ErrorCodes.NOT_FOUND,
    ErrorCodes.UNKNOWN_CHANNEL,
    ErrorCodes.UNAUTHORIZED,
    ErrorCodes.SOURCE_UNAVAILABLE,
    ErrorCodes.EDGE_UNAVAILABLE,
    ErrorCodes.TRACKER_UNAVAILABLE,
    ErrorCodes.RATE_LIMITED
)

@Serializable
data class ApiErrorBody(
    val error: String = ErrorCodes.CONFIG_INVALID,
    val message: String = ""
)

class SwarmCastApiException(
    val code: String,
    val httpStatus: Int? = null,
    val publicMessage: String = ""
) : IllegalStateException(publicMessage.ifBlank { code })

fun apiExceptionFromResponse(
    json: Json,
    body: String?,
    statusCode: Int,
    fallbackCode: String = codeFromHttpStatus(statusCode)
): SwarmCastApiException {
    val parsed = body
        ?.takeIf { it.isNotBlank() }
        ?.let { runCatching { json.decodeFromString<ApiErrorBody>(it) }.getOrNull() }

    val code = parsed?.error?.takeIf { it in allCodes } ?: fallbackCode
    val message = if (code in clientVisibleCodes) parsed?.message.orEmpty() else ""
    return SwarmCastApiException(code = code, httpStatus = statusCode, publicMessage = message)
}

fun Throwable.userMessage(fallback: String): String =
    if (this is SwarmCastApiException && publicMessage.isNotBlank()) publicMessage else fallback

private fun codeFromHttpStatus(statusCode: Int): String =
    when (statusCode) {
        401 -> ErrorCodes.UNAUTHORIZED
        404 -> ErrorCodes.NOT_FOUND
        429 -> ErrorCodes.RATE_LIMITED
        502 -> ErrorCodes.SOURCE_UNAVAILABLE
        503 -> ErrorCodes.TRACKER_UNAVAILABLE
        else -> ErrorCodes.CONFIG_INVALID
    }
