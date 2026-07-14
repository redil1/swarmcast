package tv.swarmcast.p2p

class UploadBudget(
    private val maxBytesPerSecond: Long = 1_500_000,
    private val burstSeconds: Long = 3
) {
    private var windowSecond = nowSecond()
    private var usedThisWindow = 0L

    @Synchronized
    fun tryReserve(bytes: Long): Boolean {
        require(bytes >= 0) { "bytes must be non-negative" }
        val now = nowSecond()
        if (now != windowSecond) {
            windowSecond = now
            usedThisWindow = 0L
        }

        val burstBudget = maxBytesPerSecond * burstSeconds
        if (usedThisWindow + bytes > burstBudget) return false
        usedThisWindow += bytes
        return true
    }

    private fun nowSecond(): Long = System.currentTimeMillis() / 1000L
}
