package tv.swarmcast.p2p

class UploadBudget(
    maxBytesPerSecond: Long = DEFAULT_MAX_BYTES_PER_SECOND,
    private val burstSeconds: Long = DEFAULT_BURST_SECONDS,
    private val nanoTime: () -> Long = System::nanoTime
) {
    private var rateBytesPerSecond = validatedRate(maxBytesPerSecond)
    private var capacityScaled = scaledCapacity(rateBytesPerSecond)
    private var availableScaled = capacityScaled
    private var lastRefillNanos = nanoTime()

    @Synchronized
    fun tryReserve(bytes: Long): Boolean {
        require(bytes >= 0L) { "bytes must be non-negative" }
        refill()
        if (bytes > capacityBytes()) return false

        val requestedScaled = bytes * NANOS_PER_SECOND
        if (requestedScaled > availableScaled) return false
        availableScaled -= requestedScaled
        return true
    }

    @Synchronized
    fun configureForUplink(uplinkKbps: Int, uploadEnabled: Boolean): Long {
        refill()
        val nextRate = if (uploadEnabled) payloadRateForUplinkKbps(uplinkKbps) else 0L
        rateBytesPerSecond = validatedRate(nextRate)
        capacityScaled = scaledCapacity(rateBytesPerSecond)
        availableScaled = availableScaled.coerceAtMost(capacityScaled)
        return rateBytesPerSecond
    }

    private fun refill() {
        val nowNanos = nanoTime()
        val elapsedNanos = nowNanos - lastRefillNanos
        if (elapsedNanos <= 0L) return
        lastRefillNanos = nowNanos

        if (rateBytesPerSecond == 0L || availableScaled >= capacityScaled) return
        val missingScaled = capacityScaled - availableScaled
        val nanosToFull = missingScaled / rateBytesPerSecond +
            if (missingScaled % rateBytesPerSecond == 0L) 0L else 1L
        availableScaled = if (elapsedNanos >= nanosToFull) {
            capacityScaled
        } else {
            availableScaled + elapsedNanos * rateBytesPerSecond
        }
    }

    private fun capacityBytes(): Long = capacityScaled / NANOS_PER_SECOND

    private fun validatedRate(rate: Long): Long {
        require(burstSeconds > 0L) { "burstSeconds must be positive" }
        require(rate >= 0L) { "maxBytesPerSecond must be non-negative" }
        require(rate <= Long.MAX_VALUE / burstSeconds / NANOS_PER_SECOND) {
            "upload budget capacity is too large"
        }
        return rate
    }

    private fun scaledCapacity(rate: Long): Long = rate * burstSeconds * NANOS_PER_SECOND

    companion object {
        const val DEFAULT_MAX_BYTES_PER_SECOND = 1_500_000L
        const val DEFAULT_BURST_SECONDS = 3L
        const val UPLINK_UTILIZATION_PERCENT = 80L
        private const val NANOS_PER_SECOND = 1_000_000_000L

        fun payloadRateForUplinkKbps(uplinkKbps: Int): Long {
            if (uplinkKbps <= 0) return 0L
            val safeUplinkBytesPerSecond = uplinkKbps.toLong() * 1_000L *
                UPLINK_UTILIZATION_PERCENT / 100L / 8L
            return safeUplinkBytesPerSecond.coerceAtMost(DEFAULT_MAX_BYTES_PER_SECOND)
        }
    }
}
