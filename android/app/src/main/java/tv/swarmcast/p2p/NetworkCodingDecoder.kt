package tv.swarmcast.p2p

interface NetworkCodingDecoder {
    val rank: Int
    val complete: Boolean

    fun accept(packet: CodedPacketCandidate): Boolean
    fun decode(): ByteArray
    fun recode(): Wire.CodedPayload?
}

interface NetworkCodingEncoder {
    fun generate(): Wire.CodedPayload
}

class NetworkCodingUnavailable(
    message: String = "Android network-coding decoder is not selected for production"
) : IllegalStateException(message)

class DisabledNetworkCodingDecoder(
    private val reason: String = "Android RLNC library decision is still open"
) : NetworkCodingDecoder {
    override val rank: Int = 0
    override val complete: Boolean = false

    override fun accept(packet: CodedPacketCandidate): Boolean = false

    override fun decode(): ByteArray {
        throw NetworkCodingUnavailable(reason)
    }

    override fun recode(): Wire.CodedPayload? = null
}

fun interface NetworkCodingDecoderFactory {
    fun create(seq: Int, expectedRank: Int, originalSize: Int): NetworkCodingDecoder

    companion object {
        val Disabled = NetworkCodingDecoderFactory { _, _, _ -> DisabledNetworkCodingDecoder() }
    }
}

fun interface NetworkCodingEncoderFactory {
    fun create(seq: Int, expectedRank: Int, bytes: ByteArray): NetworkCodingEncoder?

    companion object {
        val Disabled = NetworkCodingEncoderFactory { _, _, _ -> null }
    }
}
