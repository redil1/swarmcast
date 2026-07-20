package tv.swarmcast.data

import android.content.Context
import android.util.Base64
import com.google.android.gms.tasks.Task
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager
import java.security.MessageDigest
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class PlayIntegrityAttestor(
    context: Context,
    private val cloudProjectNumber: Long
) : AppAttestor {
    private val manager = IntegrityManagerFactory.createStandard(context.applicationContext)
    private val providerMutex = Mutex()
    private var provider: StandardIntegrityManager.StandardIntegrityTokenProvider? = null

    suspend fun warmUp() {
        preparedProvider()
    }

    override suspend fun attest(challenge: String): String {
        require(challenge.isNotBlank()) { "attestation challenge is empty" }
        val requestHash = MessageDigest.getInstance("SHA-256")
            .digest(challenge.toByteArray(Charsets.UTF_8))
            .let { Base64.encodeToString(it, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) }
        return runCatching { requestToken(preparedProvider(), requestHash) }
            .getOrElse {
                providerMutex.withLock { provider = null }
                requestToken(preparedProvider(), requestHash)
            }
    }

    private suspend fun preparedProvider(): StandardIntegrityManager.StandardIntegrityTokenProvider =
        providerMutex.withLock {
            provider ?: manager.prepareIntegrityToken(
                StandardIntegrityManager.PrepareIntegrityTokenRequest.builder()
                    .setCloudProjectNumber(cloudProjectNumber)
                    .build()
            ).awaitResult().also { provider = it }
        }

    private suspend fun requestToken(
        tokenProvider: StandardIntegrityManager.StandardIntegrityTokenProvider,
        requestHash: String
    ): String = tokenProvider.request(
        StandardIntegrityManager.StandardIntegrityTokenRequest.builder()
            .setRequestHash(requestHash)
            .build()
    ).awaitResult().token()
}

private suspend fun <T> Task<T>.awaitResult(): T = suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { value ->
        if (continuation.isActive) continuation.resume(value)
    }
    addOnFailureListener { error ->
        if (continuation.isActive) continuation.resumeWithException(error)
    }
    addOnCanceledListener {
        continuation.cancel()
    }
}
