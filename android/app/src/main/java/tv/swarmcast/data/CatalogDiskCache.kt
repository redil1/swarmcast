package tv.swarmcast.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class CatalogDiskCache(
    context: Context,
    private val maxRows: Int = 20_000
) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {
    init {
        setWriteAheadLoggingEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE $TABLE_CHANNELS (
                $COL_ID TEXT PRIMARY KEY,
                $COL_NAME TEXT NOT NULL COLLATE NOCASE,
                $COL_LOGO TEXT NOT NULL,
                $COL_GROUP TEXT NOT NULL COLLATE NOCASE,
                $COL_TVG_ID TEXT NOT NULL COLLATE NOCASE,
                $COL_UPDATED_AT_MS INTEGER NOT NULL
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX catalog_cache_name_idx ON $TABLE_CHANNELS($COL_NAME COLLATE NOCASE)")
        db.execSQL("CREATE INDEX catalog_cache_group_idx ON $TABLE_CHANNELS($COL_GROUP COLLATE NOCASE)")
        db.execSQL("CREATE INDEX catalog_cache_tvg_id_idx ON $TABLE_CHANNELS($COL_TVG_ID COLLATE NOCASE)")
        db.execSQL("CREATE INDEX catalog_cache_updated_at_idx ON $TABLE_CHANNELS($COL_UPDATED_AT_MS)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_CHANNELS")
        onCreate(db)
    }

    suspend fun query(query: String, limit: Int): List<Channel> = withContext(Dispatchers.IO) {
        val normalized = query.trim().lowercase()
        val safeLimit = limit.coerceIn(1, maxRows).toString()
        val sql: String
        val args: Array<String>
        if (normalized.isBlank()) {
            sql = """
                SELECT $COL_ID, $COL_NAME, $COL_LOGO, $COL_GROUP, $COL_TVG_ID
                FROM $TABLE_CHANNELS
                ORDER BY $COL_NAME COLLATE NOCASE ASC
                LIMIT ?
            """.trimIndent()
            args = arrayOf(safeLimit)
        } else {
            val pattern = "%${normalized.escapeLike()}%"
            sql = """
                SELECT $COL_ID, $COL_NAME, $COL_LOGO, $COL_GROUP, $COL_TVG_ID
                FROM $TABLE_CHANNELS
                WHERE $COL_NAME LIKE ? ESCAPE '\'
                   OR $COL_GROUP LIKE ? ESCAPE '\'
                   OR $COL_TVG_ID LIKE ? ESCAPE '\'
                ORDER BY $COL_NAME COLLATE NOCASE ASC
                LIMIT ?
            """.trimIndent()
            args = arrayOf(pattern, pattern, pattern, safeLimit)
        }
        readableDatabase.rawQuery(sql, args).use { cursor ->
            buildList {
                while (cursor.moveToNext()) add(cursor.toChannel())
            }
        }
    }

    suspend fun upsert(channels: List<Channel>) = withContext(Dispatchers.IO) {
        if (channels.isEmpty()) return@withContext
        val now = System.currentTimeMillis()
        val db = writableDatabase
        db.beginTransaction()
        try {
            channels.forEach { channel ->
                db.insertWithOnConflict(
                    TABLE_CHANNELS,
                    null,
                    ContentValues().apply {
                        put(COL_ID, channel.id)
                        put(COL_NAME, channel.name)
                        put(COL_LOGO, channel.logo)
                        put(COL_GROUP, channel.group)
                        put(COL_TVG_ID, channel.tvgId)
                        put(COL_UPDATED_AT_MS, now)
                    },
                    SQLiteDatabase.CONFLICT_REPLACE
                )
            }
            trimToMaxRows(db)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private fun trimToMaxRows(db: SQLiteDatabase) {
        val count = db.rawQuery("SELECT COUNT(*) FROM $TABLE_CHANNELS", emptyArray()).use { cursor ->
            if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
        val overLimit = count - maxRows
        if (overLimit <= 0) return
        db.execSQL(
            """
            DELETE FROM $TABLE_CHANNELS
            WHERE $COL_ID IN (
                SELECT $COL_ID FROM $TABLE_CHANNELS
                ORDER BY $COL_UPDATED_AT_MS ASC, $COL_NAME COLLATE NOCASE ASC
                LIMIT $overLimit
            )
            """.trimIndent()
        )
    }

    private fun Cursor.toChannel(): Channel =
        Channel(
            id = getString(getColumnIndexOrThrow(COL_ID)),
            name = getString(getColumnIndexOrThrow(COL_NAME)),
            logo = getString(getColumnIndexOrThrow(COL_LOGO)),
            group = getString(getColumnIndexOrThrow(COL_GROUP)),
            tvgId = getString(getColumnIndexOrThrow(COL_TVG_ID))
        )

    private fun String.escapeLike(): String =
        buildString {
            for (char in this@escapeLike) {
                if (char == '%' || char == '_' || char == '\\') append('\\')
                append(char)
            }
        }

    companion object {
        private const val DATABASE_NAME = "swarmcast-catalog-cache.sqlite"
        private const val DATABASE_VERSION = 1
        private const val TABLE_CHANNELS = "catalog_cache_channels"
        private const val COL_ID = "id"
        private const val COL_NAME = "name"
        private const val COL_LOGO = "logo"
        private const val COL_GROUP = "group_name"
        private const val COL_TVG_ID = "tvg_id"
        private const val COL_UPDATED_AT_MS = "updated_at_ms"
    }
}
