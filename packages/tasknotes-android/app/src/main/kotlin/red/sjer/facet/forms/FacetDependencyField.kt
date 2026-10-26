package red.sjer.facet

import androidx.compose.material3.*
import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import red.sjer.facet.host.FacetDependencyEditor
import red.sjer.facet.host.FacetEngineRunner

@Composable
internal fun FacetDependencyField(profileId: String, taskId: String, document: String, busy: Boolean,
    model: FacetViewModel, change: (String) -> Unit) {
    var metadata by remember(profileId, taskId) { mutableStateOf<FacetDependencyEditor?>(null) }
    var error by remember(profileId, taskId) { mutableStateOf<String?>(null) }
    var retry by remember(profileId, taskId) { mutableIntStateOf(0) }
    LaunchedEffect(profileId, taskId, model.feedbackActive, retry) {
        metadata = null; error = null
        if (!model.feedbackActive) return@LaunchedEffect
        try {
            val loaded = model.dependencyEditor(profileId)
            currentCoroutineContext().ensureActive()
            metadata = loaded
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = FacetEngineRunner.failureMessage(failure) }
    }
    val loaded = metadata
    if (loaded != null) TypedDependencies(document, loaded, busy, change)
    else {
        Text(error ?: "Loading dependency choices…")
        if (error != null) TextButton(onClick = { retry++ }, enabled = !busy) { Text("Retry dependency choices") }
    }
}
