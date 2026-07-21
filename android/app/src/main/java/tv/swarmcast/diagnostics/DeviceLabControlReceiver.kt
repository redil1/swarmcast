package tv.swarmcast.diagnostics

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DeviceLabControlReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val snapshot = when (intent.action) {
            ACTION_SNAPSHOT -> DeviceLabDiagnostics.snapshot()
            ACTION_SET_P2P -> if (intent.hasExtra(EXTRA_ENABLED)) {
                DeviceLabDiagnostics.setP2pEnabled(intent.getBooleanExtra(EXTRA_ENABLED, false))
            } else {
                null
            }
            else -> null
        }
        if (snapshot == null) {
            resultCode = Activity.RESULT_CANCELED
            resultData = ERROR_NO_ACTIVE_SESSION
            return
        }
        resultCode = Activity.RESULT_OK
        resultData = snapshot.toWireValue()
    }

    companion object {
        const val ACTION_SNAPSHOT = "tv.swarmcast.action.DEVICE_LAB_SNAPSHOT"
        const val ACTION_SET_P2P = "tv.swarmcast.action.DEVICE_LAB_SET_P2P"
        const val EXTRA_ENABLED = "enabled"
        const val ERROR_NO_ACTIVE_SESSION = "no-active-playback-session"
    }
}
