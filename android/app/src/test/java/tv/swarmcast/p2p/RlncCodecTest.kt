package tv.swarmcast.p2p

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RlncCodecTest {
    @Test
    fun matchesServerGf256WireVector() {
        val bytes = ByteArray(37) { index -> (index * 13 + 7).toByte() }
        val encoded = RlncEncoder(bytes, 4).generate(byteArrayOf(1, 2, 3, 4))

        assertArrayEquals(
            byteArrayOf(0x1b, 0x5f, 0xb3.toByte(), 0xef.toByte(), 0x3e, 0x0a, 0x46, 0x1d, 0x05, 0x00),
            encoded.data
        )
    }

    @Test
    fun reconstructsNonAlignedSegmentFromIndependentPackets() {
        val bytes = ByteArray(4097) { index -> (index * 31).toByte() }
        val encoder = RlncEncoder(bytes, 8)
        val decoder = RlncDecoder(seq = 7, k = 8, originalSize = bytes.size)

        repeat(8) { index ->
            val coeffs = ByteArray(8).also { it[index] = 1 }
            val packet = encoder.generate(coeffs)
            assertTrue(decoder.accept(packet.candidate(seq = 7, peerId = "peer-$index")))
        }

        assertTrue(decoder.complete)
        assertEquals(8, decoder.rank)
        assertArrayEquals(bytes, decoder.decode())
    }

    @Test
    fun rejectsDependentAndMalformedPacketsWithoutIncreasingRank() {
        val encoder = RlncEncoder(ByteArray(100) { it.toByte() }, 4)
        val decoder = RlncDecoder(seq = 9, k = 4, originalSize = 100)
        val payload = encoder.generate(byteArrayOf(1, 0, 0, 0))

        assertTrue(decoder.accept(payload.candidate(seq = 9)))
        assertFalse(decoder.accept(payload.candidate(seq = 9)))
        assertFalse(decoder.accept(Wire.CodedPayload(ByteArray(3), payload.data).candidate(seq = 9)))
        assertFalse(decoder.accept(payload.candidate(seq = 10)))
        assertEquals(1, decoder.rank)
    }

    @Test
    fun partialDecoderRecodesUsefulPacketForAnotherPeer() {
        val bytes = ByteArray(2048) { index -> (index * 17).toByte() }
        val encoder = RlncEncoder(bytes, 4)
        val partial = RlncDecoder(seq = 11, k = 4, originalSize = bytes.size)
        val downstream = RlncDecoder(seq = 11, k = 4, originalSize = bytes.size)

        assertTrue(partial.accept(encoder.generate(byteArrayOf(1, 0, 0, 0)).candidate(seq = 11)))
        assertTrue(partial.accept(encoder.generate(byteArrayOf(0, 1, 0, 0)).candidate(seq = 11)))
        val recoded = partial.recode()

        assertNotNull(recoded)
        assertTrue(downstream.accept(checkNotNull(recoded).candidate(seq = 11)))
        assertEquals(1, downstream.rank)
    }

    private fun Wire.CodedPayload.candidate(seq: Int, peerId: String = "peer") =
        CodedPacketCandidate(peerId = peerId, seq = seq, coeffs = coeffs, data = data)
}
