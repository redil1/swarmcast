package tv.swarmcast.p2p

import org.junit.Test

class PeerConnectionManagerConfigTest {
    @Test
    fun `initial ICE configuration may be deferred until authentication`() {
        validateIceServerConfigs(emptyList(), allowEmpty = true)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `runtime ICE update rejects an empty configuration`() {
        validateIceServerConfigs(emptyList())
    }

    @Test(expected = IllegalArgumentException::class)
    fun `ICE update rejects incomplete credentials`() {
        validateIceServerConfigs(
            listOf(IceServerConfig(listOf("turn:relay.example"), username = "viewer"))
        )
    }

    @Test
    fun `ICE update accepts STUN and complete TURN configurations`() {
        validateIceServerConfigs(
            listOf(
                IceServerConfig(listOf("stun:stun.example")),
                IceServerConfig(
                    listOf("turn:relay.example"),
                    username = "viewer",
                    credential = "secret"
                )
            )
        )
    }
}
