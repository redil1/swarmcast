package tv.swarmcast.p2p

import java.security.MessageDigest

class SegmentStore(private val maxBytes: Long = 64L * 1024 * 1024) {
    data class Entry(val seq: Int, val bytes: ByteArray, val sha256: String)

    private val map = LinkedHashMap<Int, Entry>(64, 0.75f, true)
    private var totalBytes = 0L

    @Synchronized fun get(seq: Int): Entry? = map[seq]

    @Synchronized fun heldSeqs(): Set<Int> = map.keys.toSet()

    @Synchronized fun putVerified(seq: Int, bytes: ByteArray, expectedSha256: String): Boolean {
        val actual = sha256(bytes)
        if (actual != expectedSha256) return false

        map[seq]?.let { totalBytes -= it.bytes.size }
        map.remove(seq)
        map[seq] = Entry(seq, bytes, actual)
        totalBytes += bytes.size

        val iterator = map.entries.iterator()
        while (totalBytes > maxBytes && iterator.hasNext()) {
            totalBytes -= iterator.next().value.bytes.size
            iterator.remove()
        }
        return true
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }
}
