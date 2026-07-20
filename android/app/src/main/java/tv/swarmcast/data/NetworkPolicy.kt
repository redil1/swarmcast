package tv.swarmcast.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager

class NetworkPolicy(private val context: Context) {
    fun snapshot(): NetworkPolicySnapshot {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val transport = when {
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "wifi"
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "cellular"
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "ethernet"
            else -> "unknown"
        }
        val metered = caps == null ||
            !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) ||
            cm.isActiveNetworkMetered
        val batteryPct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val charging = bm.isCharging
        val batteryOk = charging || batteryPct > MIN_UPLOAD_BATTERY_PERCENT
        val isWifi = transport == "wifi"
        val uploadAllowed = isWifi && !metered && batteryOk
        val p2pDownloadAllowed = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        return NetworkPolicySnapshot(
            transport = transport,
            metered = metered,
            batteryPercent = batteryPct.coerceIn(0, 100),
            charging = charging,
            uplinkKbps = if (uploadAllowed) caps?.linkUpstreamBandwidthKbps ?: 0 else 0,
            uploadAllowed = uploadAllowed,
            p2pDownloadAllowed = p2pDownloadAllowed
        )
    }

    fun uploadAllowed(): Boolean = snapshot().uploadAllowed

    fun p2pDownloadAllowed(): Boolean = snapshot().p2pDownloadAllowed

    fun isWifiUnmetered(): Boolean {
        val current = snapshot()
        return current.transport == "wifi" && !current.metered
    }

    fun measuredUplinkKbps(): Int {
        return snapshot().uplinkKbps
    }

    companion object {
        const val MIN_UPLOAD_BATTERY_PERCENT = 25
    }
}

data class NetworkPolicySnapshot(
    val transport: String,
    val metered: Boolean,
    val batteryPercent: Int,
    val charging: Boolean,
    val uplinkKbps: Int,
    val uploadAllowed: Boolean,
    val p2pDownloadAllowed: Boolean
)

data class P2pPermissions(
    val downloadAllowed: Boolean,
    val uploadAllowed: Boolean
)

fun p2pPermissions(enabled: Boolean, snapshot: NetworkPolicySnapshot): P2pPermissions =
    P2pPermissions(
        downloadAllowed = enabled && snapshot.p2pDownloadAllowed,
        uploadAllowed = enabled && snapshot.uploadAllowed
    )
