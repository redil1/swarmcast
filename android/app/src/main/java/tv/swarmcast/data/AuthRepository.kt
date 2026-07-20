package tv.swarmcast.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class AuthRepository(
    private val apiBase: String,
    private val appApiKey: String,
    private val http: OkHttpClient = OkHttpClient(),
    private val json: Json = Json { ignoreUnknownKeys = true },
    private val clockMs: () -> Long = System::currentTimeMillis
) {
    private var cached: TokenResponse? = null
    private var issuedAtMs: Long = 0
    private val refreshMutex = Mutex()

    suspend fun token(): String = session().token

    suspend fun session(): TokenResponse {
        val current = cached
        if (current != null && current.isUsableAt(clockMs(), issuedAtMs)) {
            return current
        }
        return refreshMutex.withLock {
            cached?.takeIf { it.isUsableAt(clockMs(), issuedAtMs) } ?: fetch()
        }
    }

    suspend fun refresh(): TokenResponse = refreshMutex.withLock { fetch() }

    private suspend fun fetch(): TokenResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$apiBase/token")
            .post(ByteArray(0).toRequestBody("application/json".toMediaType()))
            .header("x-app-key", appApiKey)
            .build()

        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw apiExceptionFromResponse(json, response.body?.string(), response.code)
            }
            val body = response.body?.string() ?: error("empty token response")
            json.decodeFromString<TokenResponse>(body).validated(clockMs()).also {
                cached = it
                issuedAtMs = clockMs()
            }
        }
    }
}

@Serializable
data class TokenResponse(
    val token: String,
    val expiresIn: Long,
    val iceServers: List<IceServerResponse> = emptyList()
) {
    fun isUsableAt(nowMs: Long, receivedAtMs: Long): Boolean {
        val tokenExpiresAtMs = receivedAtMs + expiresIn * 1000L
        val turnExpiresAtMs = iceServers.mapNotNull { it.expiresAt }.minOrNull()?.times(1000L)
        val expiresAtMs = minOf(tokenExpiresAtMs, turnExpiresAtMs ?: Long.MAX_VALUE)
        return nowMs < expiresAtMs - REFRESH_MARGIN_MS
    }

    fun validated(nowMs: Long): TokenResponse {
        require(token.isNotBlank()) { "token response is missing token" }
        require(expiresIn in 1..86_400) { "token response has invalid expiry" }
        require(iceServers.isNotEmpty()) { "token response is missing ICE servers" }
        iceServers.forEach { it.validated(nowMs) }
        return this
    }

    companion object {
        const val REFRESH_MARGIN_MS = 60_000L
    }
}

@Serializable
data class IceServerResponse(
    val urls: List<String>,
    val username: String = "",
    val credential: String = "",
    val expiresAt: Long? = null
) {
    fun validated(nowMs: Long): IceServerResponse {
        require(urls.isNotEmpty() && urls.all { it.isNotBlank() }) { "ICE server response has invalid URLs" }
        require(username.isBlank() == credential.isBlank()) { "ICE server credentials are incomplete" }
        if (username.isNotBlank()) {
            val nowSeconds = nowMs / 1000L
            require(expiresAt != null && expiresAt in (nowSeconds + 1)..(nowSeconds + 86_400)) {
                "TURN credentials are expired or exceed the maximum lifetime"
            }
        } else {
            require(expiresAt == null) { "STUN server must not include credential expiry" }
        }
        return this
    }
}
