package tv.swarmcast.p2p

import java.nio.ByteBuffer

object Wire {
    const val MAGIC: Byte = 0x5C
    const val CHUNK: Int = 16 * 1024
    const val REQUEST: Byte = 0x01
    const val DATA: Byte = 0x02
    const val DATA_END: Byte = 0x03
    const val CANCEL: Byte = 0x04
    const val BITFIELD: Byte = 0x05
    const val REJECT: Byte = 0x06
    const val CODED: Byte = 0x07
    const val RANK: Byte = 0x08
    const val CODED_REQUEST: Byte = 0x09

    fun frame(type: Byte, seq: Int, payload: ByteArray = ByteArray(0)): ByteBuffer =
        ByteBuffer.allocate(10 + payload.size).apply {
            put(MAGIC)
            put(type)
            putInt(seq)
            putInt(payload.size)
            put(payload)
            flip()
        }

    data class Msg(val type: Byte, val seq: Int, val payload: ByteArray)
    data class CodedPayload(val coeffs: ByteArray, val data: ByteArray)
    data class RankPayload(val seq: Int, val rank: Int)

    fun parse(buf: ByteBuffer): Msg? {
        if (buf.remaining() < 10 || buf.get() != MAGIC) return null
        val type = buf.get()
        val seq = buf.int
        val len = buf.int
        if (len != buf.remaining()) return null
        val payload = ByteArray(len)
        buf.get(payload)
        return Msg(type, seq, payload)
    }

    fun bitfield(seqs: Collection<Int>): ByteArray =
        ByteBuffer.allocate(seqs.size * 4).apply {
            seqs.forEach { putInt(it) }
            flip()
        }.let { buffer -> ByteArray(buffer.remaining()).also { buffer.get(it) } }

    fun parseBitfield(payload: ByteArray): Set<Int>? {
        if (payload.size % 4 != 0) return null
        val buffer = ByteBuffer.wrap(payload)
        val out = LinkedHashSet<Int>()
        while (buffer.remaining() >= 4) out.add(buffer.int)
        return out
    }

    fun codedPayload(coeffs: ByteArray, data: ByteArray): ByteArray {
        require(coeffs.size <= 255) { "coefficient vector too large" }
        return ByteBuffer.allocate(1 + coeffs.size + data.size).apply {
            put(coeffs.size.toByte())
            put(coeffs)
            put(data)
        }.array()
    }

    fun parseCodedPayload(payload: ByteArray): CodedPayload? {
        if (payload.isEmpty()) return null
        val coeffCount = payload[0].toInt() and 0xff
        if (payload.size < 1 + coeffCount) return null
        return CodedPayload(
            coeffs = payload.copyOfRange(1, 1 + coeffCount),
            data = payload.copyOfRange(1 + coeffCount, payload.size)
        )
    }

    fun rankPayload(seq: Int, rank: Int): ByteArray =
        ByteBuffer.allocate(6).apply {
            putInt(seq)
            putShort((rank and 0xffff).toShort())
        }.array()

    fun parseRankPayload(payload: ByteArray): RankPayload? {
        if (payload.size != 6) return null
        val buffer = ByteBuffer.wrap(payload)
        return RankPayload(
            seq = buffer.int,
            rank = buffer.short.toInt() and 0xffff
        )
    }
}
