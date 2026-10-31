package red.sjer.facet

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import red.sjer.facet.host.FacetReminders

@Composable
internal fun ReminderSettings(model: FacetViewModel) {
    val context = LocalContext.current
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && FacetReminders.permissionGranted(context)) model.setReminderEnabled(true)
        else model.reminderPermissionDenied()
    }
    Text("Android reminders")
    Text("Delivery uses inexact alarms and the nearest 64 reminders within 30 days. Android notification permissions and battery policy control when they arrive.")
    Text(model.reminderStatus)
    TextButton(onClick = {
        if (model.remindersEnabled) model.setReminderEnabled(false)
        else if (Build.VERSION.SDK_INT >= 33 && !FacetReminders.permissionGranted(context)) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        else model.setReminderEnabled(true)
    }, enabled = !model.busy) { Text(if (model.remindersEnabled) "Disable reminders on this device" else "Enable reminders on this device") }
}
