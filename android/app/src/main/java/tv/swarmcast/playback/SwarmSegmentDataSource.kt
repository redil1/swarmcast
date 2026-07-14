package tv.swarmcast.playback

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import tv.swarmcast.p2p.SegmentScheduler
import java.io.IOException

@OptIn(UnstableApi::class)
class SwarmSegmentDataSource private constructor(
    private val scheduler: SegmentScheduler,
    private val fallbackDataSource: DataSource,
    private val segmentUrgencyMs: Long
) : BaseDataSource(true) {
    private var openedDataSpec: DataSpec? = null
    private var openedUri: Uri? = null
    private var delegateOpen = false
    private var memoryOpen = false
    private var bytes = ByteArray(0)
    private var readPosition = 0
    private var bytesRemaining = 0

    override fun open(dataSpec: DataSpec): Long {
        openedDataSpec = dataSpec
        openedUri = dataSpec.uri
        transferInitializing(dataSpec)

        val segment = if (dataSpec.httpMethod == DataSpec.HTTP_METHOD_GET) {
            SegmentRequest.fromUri(dataSpec.uri)
        } else {
            null
        } ?: return openFallback(dataSpec)

        val fullSegment = try {
            runBlocking(Dispatchers.IO) {
                scheduler.fetchSegment(segment.seq, segment.fileName, segmentUrgencyMs)
            }
        } catch (error: Throwable) {
            throw IOException("segment fetch failed: ${segment.fileName}", error)
        }

        val start = dataSpec.position.coerceAtMost(fullSegment.size.toLong()).toInt()
        val available = fullSegment.size - start
        val requested = if (dataSpec.length == C.LENGTH_UNSET.toLong()) {
            available
        } else {
            dataSpec.length.coerceAtMost(available.toLong()).toInt()
        }

        bytes = if (start == 0 && requested == fullSegment.size) {
            fullSegment
        } else {
            fullSegment.copyOfRange(start, start + requested)
        }
        readPosition = 0
        bytesRemaining = bytes.size
        memoryOpen = true
        transferStarted(dataSpec)
        return bytes.size.toLong()
    }

    override fun read(buffer: ByteArray, offset: Int, readLength: Int): Int {
        if (readLength == 0) return 0

        if (delegateOpen) {
            val read = fallbackDataSource.read(buffer, offset, readLength)
            if (read > 0) bytesTransferred(read)
            return read
        }

        if (!memoryOpen || bytesRemaining == 0) return C.RESULT_END_OF_INPUT

        val bytesToRead = minOf(readLength, bytesRemaining)
        bytes.copyInto(buffer, offset, readPosition, readPosition + bytesToRead)
        readPosition += bytesToRead
        bytesRemaining -= bytesToRead
        bytesTransferred(bytesToRead)
        return bytesToRead
    }

    override fun getUri(): Uri? =
        if (delegateOpen) fallbackDataSource.uri else openedUri

    override fun getResponseHeaders(): Map<String, List<String>> =
        if (delegateOpen) fallbackDataSource.responseHeaders else emptyMap()

    override fun close() {
        val shouldEndTransfer = delegateOpen || memoryOpen
        try {
            if (delegateOpen) fallbackDataSource.close()
        } finally {
            delegateOpen = false
            memoryOpen = false
            openedDataSpec = null
            openedUri = null
            bytes = ByteArray(0)
            readPosition = 0
            bytesRemaining = 0
            if (shouldEndTransfer) transferEnded()
        }
    }

    private fun openFallback(dataSpec: DataSpec): Long {
        val length = fallbackDataSource.open(dataSpec)
        delegateOpen = true
        transferStarted(dataSpec)
        return length
    }

    private data class SegmentRequest(val fileName: String, val seq: Int) {
        companion object {
            private val supportedExtensions = setOf("m4s", "mp4", "ts")
            private val digits = Regex("\\d+")

            fun fromUri(uri: Uri): SegmentRequest? {
                val fileName = uri.lastPathSegment ?: return null
                val lower = fileName.lowercase()
                if (lower.contains("init") || lower.endsWith(".m3u8")) return null

                val extension = lower.substringAfterLast('.', missingDelimiterValue = "")
                if (extension !in supportedExtensions) return null

                val seq = digits.findAll(fileName)
                    .lastOrNull()
                    ?.value
                    ?.toIntOrNull()
                    ?: return null
                return SegmentRequest(fileName, seq)
            }
        }
    }

    class Factory(
        private val scheduler: SegmentScheduler,
        private val fallbackFactory: DataSource.Factory,
        private val segmentUrgencyMs: Long
    ) : DataSource.Factory {
        override fun createDataSource(): DataSource =
            SwarmSegmentDataSource(
                scheduler = scheduler,
                fallbackDataSource = fallbackFactory.createDataSource(),
                segmentUrgencyMs = segmentUrgencyMs
            )
    }
}
