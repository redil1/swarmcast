package tv.swarmcast.data

import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle

data class AppConfig(
    val apiBase: String,
    val trackerWsUrl: String,
    val appApiKey: String,
    val featureFlags: AppFeatureFlags
) {
    companion object {
        fun from(context: Context): AppConfig {
            val appInfo = context.packageManager.getApplicationInfo(
                context.packageName,
                PackageManager.GET_META_DATA
            )
            val meta = appInfo.metaData ?: Bundle.EMPTY
            return AppConfig(
                apiBase = required(meta, "tv.swarmcast.API_BASE").trimEnd('/'),
                trackerWsUrl = required(meta, "tv.swarmcast.TRACKER_WS_URL"),
                appApiKey = required(meta, "tv.swarmcast.APP_API_KEY"),
                featureFlags = AppFeatureFlags.from(meta)
            )
        }

        private fun required(meta: Bundle, key: String): String =
            meta.getString(key)?.takeIf { it.isNotBlank() } ?: error("$key is not configured")
    }
}

data class AppFeatureFlags(
    val p2pEnabled: Boolean = true,
    val edgeOnlyMode: Boolean = false,
    val rlncEnabled: Boolean = false
) {
    val p2pToggleAllowed: Boolean
        get() = p2pEnabled && !edgeOnlyMode

    val initialP2pEnabled: Boolean
        get() = p2pToggleAllowed

    companion object {
        fun from(meta: Bundle): AppFeatureFlags = AppFeatureFlags(
            p2pEnabled = optionalBoolean(meta, "tv.swarmcast.P2P_ENABLED", true),
            edgeOnlyMode = optionalBoolean(meta, "tv.swarmcast.EDGE_ONLY_MODE", false),
            rlncEnabled = optionalBoolean(meta, "tv.swarmcast.RLNC_ENABLED", false)
        )

        private fun optionalBoolean(meta: Bundle, key: String, fallback: Boolean): Boolean {
            val raw = meta.getString(key)?.trim()?.lowercase() ?: return fallback
            return when (raw) {
                "1", "true", "yes", "on" -> true
                "0", "false", "no", "off" -> false
                else -> error("$key must be a boolean flag")
            }
        }
    }
}
