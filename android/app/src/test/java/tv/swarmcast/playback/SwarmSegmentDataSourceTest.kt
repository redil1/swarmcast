package tv.swarmcast.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SwarmSegmentDataSourceTest {
    @Test
    fun parsesSequenceBeforeM4sExtensionDigits() {
        assertEquals(892_359_347, segmentSequenceFromFileName("seg_892359347.m4s"))
        assertEquals(42, segmentSequenceFromFileName("channel-part-42.mp4"))
        assertEquals(7, segmentSequenceFromFileName("seg_00000007.ts"))
    }

    @Test
    fun rejectsManifestsInitializationFilesAndUnsupportedFiles() {
        assertNull(segmentSequenceFromFileName("playlist.m3u8"))
        assertNull(segmentSequenceFromFileName("init.mp4"))
        assertNull(segmentSequenceFromFileName("segment-7.aac"))
    }
}
