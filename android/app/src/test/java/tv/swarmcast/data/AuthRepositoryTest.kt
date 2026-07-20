package tv.swarmcast.data

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthRepositoryTest {
    @Test
    fun bindsPlayIntegrityTokenToServerChallenge() {
        val server = MockWebServer()
        val nowMs = 1_700_000_000_000L
        server.enqueue(
            MockResponse()
                .setHeader("content-type", "application/json")
                .setBody("""{"challenge":"signed-attestation-challenge-value-1234567890","expiresAt":1700000120}""")
        )
        server.enqueue(tokenResponse("attested-token", 1_700_000_600L))
        server.start()
        val repository = AuthRepository(
            apiBase = server.url("/").toString().removeSuffix("/"),
            appApiKey = "app-key",
            appAttestor = object : AppAttestor {
                override suspend fun attest(challenge: String): String {
                    assertEquals("signed-attestation-challenge-value-1234567890", challenge)
                    return "integrity-token"
                }
            },
            clockMs = { nowMs }
        )

        try {
            assertEquals("attested-token", runBlocking { repository.token() })
            val challengeRequest = server.takeRequest()
            assertEquals("/attestation/challenge", challengeRequest.path)
            assertEquals("app-key", challengeRequest.getHeader("x-app-key"))
            val tokenRequest = server.takeRequest()
            assertEquals("/token", tokenRequest.path)
            assertEquals("app-key", tokenRequest.getHeader("x-app-key"))
            val body = tokenRequest.body.readUtf8()
            assertTrue(body.contains("\"challenge\":\"signed-attestation-challenge-value-1234567890\""))
            assertTrue(body.contains("\"integrityToken\":\"integrity-token\""))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun appliesTurnExpiryToCacheAndRefreshesCredentials() {
        val server = MockWebServer()
        var nowMs = 1_700_000_000_000L
        server.enqueue(tokenResponse("token-1", 1_700_000_120L))
        server.enqueue(tokenResponse("token-2", 1_700_000_600L))
        server.start()
        val repository = AuthRepository(
            apiBase = server.url("/").toString().removeSuffix("/"),
            appApiKey = "app-key",
            clockMs = { nowMs }
        )

        try {
            val first = runBlocking { repository.session() }
            assertEquals("token-1", first.token)
            assertEquals("turn-user", first.iceServers[1].username)
            assertEquals("turn-password", first.iceServers[1].credential)

            nowMs += 30_000L
            assertEquals("token-1", runBlocking { repository.token() })
            assertEquals(1, server.requestCount)

            nowMs += 31_000L
            assertEquals("token-2", runBlocking { repository.token() })
            assertEquals(2, server.requestCount)
            repeat(2) {
                val request = server.takeRequest()
                assertEquals("/token", request.path)
                assertEquals("app-key", request.getHeader("x-app-key"))
            }
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun rejectsIncompleteOrExpiredIceCredentials() {
        val nowMs = 1_700_000_000_000L
        val base = TokenResponse(
            token = "token",
            expiresIn = 600,
            iceServers = listOf(IceServerResponse(listOf("stun:stun.swarmcast.tv:3478")))
        )
        assertEquals(base, base.validated(nowMs))

        val incomplete = base.copy(iceServers = listOf(
            IceServerResponse(listOf("turn:turn.swarmcast.tv:3478"), username = "user")
        ))
        assertTrue(runCatching { incomplete.validated(nowMs) }.exceptionOrNull()?.message?.contains("incomplete") == true)

        val expired = base.copy(iceServers = listOf(
            IceServerResponse(
                listOf("turn:turn.swarmcast.tv:3478"),
                username = "user",
                credential = "password",
                expiresAt = 1_700_000_000L
            )
        ))
        assertTrue(runCatching { expired.validated(nowMs) }.exceptionOrNull()?.message?.contains("expired") == true)
    }

    private fun tokenResponse(token: String, turnExpiresAt: Long) = MockResponse()
        .setHeader("content-type", "application/json")
        .setBody(
            """{
              "token":"$token",
              "expiresIn":600,
              "iceServers":[
                {"urls":["stun:stun.swarmcast.tv:3478"]},
                {
                  "urls":["turn:turn.swarmcast.tv:3478?transport=udp"],
                  "username":"turn-user",
                  "credential":"turn-password",
                  "expiresAt":$turnExpiresAt
                }
              ]
            }""".trimIndent()
        )
}
