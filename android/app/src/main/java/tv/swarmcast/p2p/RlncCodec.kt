package tv.swarmcast.p2p

import com.backblaze.erasure.Galois
import java.security.SecureRandom

object RlncCodec {
    val decoderFactory = NetworkCodingDecoderFactory { seq, expectedRank, originalSize ->
        RlncDecoder(seq, expectedRank, originalSize)
    }
    val encoderFactory = NetworkCodingEncoderFactory { _, expectedRank, bytes ->
        runCatching { RlncEncoder(bytes, expectedRank) }.getOrNull()
    }
}

internal class RlncEncoder(
    bytes: ByteArray,
    private val k: Int,
    private val random: SecureRandom = SecureRandom()
) : NetworkCodingEncoder {
    private val blockSize: Int
    private val blocks: Array<ByteArray>

    init {
        require(bytes.isNotEmpty()) { "RLNC input must not be empty" }
        require(k in 1..255) { "RLNC rank must be in [1,255]" }
        blockSize = (bytes.size + k - 1) / k
        blocks = Array(k) { index ->
            ByteArray(blockSize).also { block ->
                val start = index * blockSize
                if (start < bytes.size) {
                    bytes.copyInto(block, endIndex = minOf(start + blockSize, bytes.size), startIndex = start)
                }
            }
        }
    }

    override fun generate(): Wire.CodedPayload = generate(null)

    internal fun generate(requestedCoeffs: ByteArray?): Wire.CodedPayload {
        val coeffs = requestedCoeffs?.copyOf() ?: randomNonZero(k, random)
        require(coeffs.size == k) { "coefficient vector length must equal rank" }
        val data = ByteArray(blockSize)
        blocks.forEachIndexed { index, block -> scaleXorInto(data, block, coeffs[index]) }
        return Wire.CodedPayload(coeffs, data)
    }
}

internal class RlncDecoder(
    private val seq: Int,
    private val k: Int,
    originalSize: Int,
    private val random: SecureRandom = SecureRandom()
) : NetworkCodingDecoder {
    private data class Row(val coeffs: ByteArray, val data: ByteArray)

    private val originalSize = originalSize.also { require(it > 0) { "original size must be positive" } }
    private val blockSize = (originalSize + k - 1) / k
    private val rows = arrayOfNulls<Row>(k)

    init {
        require(k in 1..255) { "RLNC rank must be in [1,255]" }
    }

    @get:Synchronized
    override val rank: Int
        get() = rows.count { it != null }

    @get:Synchronized
    override val complete: Boolean
        get() = rows.all { it != null }

    @Synchronized
    override fun accept(packet: CodedPacketCandidate): Boolean {
        if (complete || packet.seq != seq || packet.coeffs.size != k || packet.data.size != blockSize) return false
        var coeffs = packet.coeffs.copyOf()
        var data = packet.data.copyOf()

        rows.forEachIndexed { pivot, row ->
            row ?: return@forEachIndexed
            val factor = coeffs[pivot]
            if (factor.toInt() != 0) {
                scaleXorInto(coeffs, row.coeffs, factor)
                scaleXorInto(data, row.data, factor)
            }
        }

        val pivot = coeffs.indexOfFirst { it.toInt() != 0 }
        if (pivot < 0) return false
        val inverse = Galois.divide(1, coeffs[pivot])
        coeffs = scale(coeffs, inverse)
        data = scale(data, inverse)

        rows.forEachIndexed { index, row ->
            row ?: return@forEachIndexed
            val factor = row.coeffs[pivot]
            if (factor.toInt() != 0) {
                scaleXorInto(row.coeffs, coeffs, factor)
                scaleXorInto(row.data, data, factor)
                rows[index] = row
            }
        }
        rows[pivot] = Row(coeffs, data)
        return true
    }

    @Synchronized
    override fun decode(): ByteArray {
        check(complete) { "RLNC decoder is incomplete" }
        val padded = ByteArray(k * blockSize)
        rows.forEachIndexed { index, row ->
            checkNotNull(row).data.copyInto(padded, index * blockSize)
        }
        return padded.copyOf(originalSize)
    }

    @Synchronized
    override fun recode(): Wire.CodedPayload? {
        val available = rows.filterNotNull()
        if (available.isEmpty()) return null
        val localCoeffs = randomNonZero(available.size, random)
        val coeffs = ByteArray(k)
        val data = ByteArray(blockSize)
        available.forEachIndexed { index, row ->
            scaleXorInto(coeffs, row.coeffs, localCoeffs[index])
            scaleXorInto(data, row.data, localCoeffs[index])
        }
        return Wire.CodedPayload(coeffs, data)
    }
}

private fun randomNonZero(size: Int, random: SecureRandom): ByteArray {
    val out = ByteArray(size)
    do random.nextBytes(out) while (out.all { it.toInt() == 0 })
    return out
}

private fun scale(input: ByteArray, coefficient: Byte): ByteArray =
    ByteArray(input.size).also { out ->
        input.forEachIndexed { index, value -> out[index] = Galois.multiply(value, coefficient) }
    }

private fun scaleXorInto(target: ByteArray, source: ByteArray, coefficient: Byte) {
    require(target.size == source.size) { "RLNC vectors must have equal length" }
    if (coefficient.toInt() == 0) return
    source.forEachIndexed { index, value ->
        target[index] = (target[index].toInt() xor Galois.multiply(value, coefficient).toInt()).toByte()
    }
}
