package tv.swarmcast.data

import kotlinx.coroutines.Dispatchers
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
    private val json: Json = Json { ignoreUnknownKeys = true }
) {
    private var cached: TokenResponse? = null
    private var issuedAtMs: Long = 0

    suspend fun token(): String {
        val current = cached
        if (current != null && System.currentTimeMillis() - issuedAtMs < (current.expiresIn - 300) * 1000L) {
            return current.token
        }
        return refresh().token
    }

    suspend fun refresh(): TokenResponse = withContext(Dispatchers.IO) {
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
            json.decodeFromString<TokenResponse>(body).also {
                cached = it
                issuedAtMs = System.currentTimeMillis()
            }
        }
    }
}

@Serializable
data class TokenResponse(
    val token: String,
    val expiresIn: Long
)
