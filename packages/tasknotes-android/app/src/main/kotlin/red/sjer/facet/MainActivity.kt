package red.sjer.facet

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.lifecycle.ViewModelProvider

class MainActivity : ComponentActivity() {
    private lateinit var model: FacetViewModel
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        model = ViewModelProvider(this)[FacetViewModel::class.java]
        acceptReminder(intent)
        setContent { MaterialTheme { FacetScreen(model) } }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); acceptReminder(intent) }
    private fun acceptReminder(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW) intent.data?.toString()?.let(model::requestReminder)
    }
    override fun onStart() { super.onStart(); model.resumeSync() }
    override fun onStop() { model.pauseSync(); super.onStop() }
}
