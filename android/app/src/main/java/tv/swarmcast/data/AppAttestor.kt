package tv.swarmcast.data

interface AppAttestor {
    suspend fun attest(challenge: String): String
}
