package tv.swarmcast.p2p

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class UploadBudgetTest {
    @Test
    fun enforcesBurstCapacityAndSustainedRefillRate() {
        val clock = FakeNanoClock()
        val budget = UploadBudget(maxBytesPerSecond = 100L, burstSeconds = 3L, nanoTime = clock::read)

        assertTrue(budget.tryReserve(300L))
        assertFalse(budget.tryReserve(1L))

        clock.advanceSeconds(1L)
        assertTrue(budget.tryReserve(100L))
        assertFalse(budget.tryReserve(1L))

        clock.advanceNanos(500_000_000L)
        assertTrue(budget.tryReserve(50L))
        assertFalse(budget.tryReserve(1L))
    }

    @Test
    fun preservesFractionalRefillCreditAcrossReservations() {
        val clock = FakeNanoClock()
        val budget = UploadBudget(maxBytesPerSecond = 3L, burstSeconds = 1L, nanoTime = clock::read)
        assertTrue(budget.tryReserve(3L))

        clock.advanceNanos(166_666_667L)
        assertFalse(budget.tryReserve(1L))
        clock.advanceNanos(166_666_667L)
        assertTrue(budget.tryReserve(1L))
    }

    @Test
    fun ignoresClockRegressionWithoutMintingTokens() {
        val clock = FakeNanoClock(10_000_000_000L)
        val budget = UploadBudget(maxBytesPerSecond = 100L, burstSeconds = 1L, nanoTime = clock::read)
        assertTrue(budget.tryReserve(100L))

        clock.nowNanos = 9_000_000_000L
        assertFalse(budget.tryReserve(1L))
        clock.nowNanos = 10_500_000_000L
        assertTrue(budget.tryReserve(50L))
        assertFalse(budget.tryReserve(1L))
    }

    @Test
    fun reconfigurationClampsCapacityAndDoesNotMintASecondBurst() {
        val clock = FakeNanoClock()
        val budget = UploadBudget(maxBytesPerSecond = 200L, burstSeconds = 2L, nanoTime = clock::read)
        assertTrue(budget.tryReserve(400L))
        clock.advanceSeconds(1L)

        assertEquals(100L, budget.configureForUplink(uplinkKbps = 1, uploadEnabled = true))
        assertTrue(budget.tryReserve(200L))
        assertFalse(budget.tryReserve(1L))

        assertEquals(0L, budget.configureForUplink(uplinkKbps = 1, uploadEnabled = false))
        assertFalse(budget.tryReserve(1L))

        clock.advanceSeconds(10L)
        assertEquals(100L, budget.configureForUplink(uplinkKbps = 1, uploadEnabled = true))
        assertFalse(budget.tryReserve(1L))
        clock.advanceNanos(10_000_000L)
        assertTrue(budget.tryReserve(1L))
    }

    @Test
    fun derivesConservativePayloadRateFromReportedUplink() {
        assertEquals(0L, UploadBudget.payloadRateForUplinkKbps(0))
        assertEquals(1_000_000L, UploadBudget.payloadRateForUplinkKbps(10_000))
        assertEquals(1_500_000L, UploadBudget.payloadRateForUplinkKbps(15_000))
        assertEquals(1_500_000L, UploadBudget.payloadRateForUplinkKbps(100_000))
        assertEquals(1_500_000L, UploadBudget.payloadRateForUplinkKbps(Int.MAX_VALUE))
    }

    @Test
    fun rejectsInvalidOrOverflowingConfigurationAndRequests() {
        val clock = FakeNanoClock()
        assertThrows(IllegalArgumentException::class.java) {
            UploadBudget(maxBytesPerSecond = -1L, nanoTime = clock::read)
        }
        assertThrows(IllegalArgumentException::class.java) {
            UploadBudget(maxBytesPerSecond = Long.MAX_VALUE, nanoTime = clock::read)
        }
        val budget = UploadBudget(maxBytesPerSecond = 100L, burstSeconds = 1L, nanoTime = clock::read)
        assertThrows(IllegalArgumentException::class.java) { budget.tryReserve(-1L) }
        assertFalse(budget.tryReserve(Long.MAX_VALUE))
        assertTrue(budget.tryReserve(100L))
    }

    @Test
    fun serializesConcurrentReservationsAgainstOneSharedCapacity() {
        val budget = UploadBudget(maxBytesPerSecond = 100L, burstSeconds = 1L, nanoTime = { 0L })
        val workers = 32
        val ready = CountDownLatch(workers)
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(workers)
        try {
            val results = (0 until workers).map {
                executor.submit<Boolean> {
                    ready.countDown()
                    start.await()
                    budget.tryReserve(25L)
                }
            }
            assertTrue(ready.await(5L, TimeUnit.SECONDS))
            start.countDown()
            assertEquals(4, results.count { it.get(5L, TimeUnit.SECONDS) })
        } finally {
            executor.shutdownNow()
        }
    }

    private class FakeNanoClock(var nowNanos: Long = 0L) {
        fun read(): Long = nowNanos
        fun advanceNanos(value: Long) {
            nowNanos += value
        }
        fun advanceSeconds(value: Long) = advanceNanos(value * 1_000_000_000L)
    }
}
