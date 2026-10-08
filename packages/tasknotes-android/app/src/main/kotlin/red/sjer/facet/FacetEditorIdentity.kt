package red.sjer.facet

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import red.sjer.facet.host.VaultTask

/** Save the originally loaded revision and open JSON; restoration never consults a new selected vault. */
internal fun saveTaskBasis(task: VaultTask): List<String> = listOf(
    task.id, task.path, task.title, task.status, task.priority, task.completed.toString(),
    task.revision, task.properties.toString(), task.body, task.isRecurring.toString(),
    task.isBlocked.toString(), task.isBlocking.toString(), task.hasActiveTimeSession.toString(),
    task.totalTrackedMinutes.toString(), task.occurrenceDate.orEmpty(), task.effectiveDate.orEmpty(),
    task.isPending.toString(),
)

internal fun restoreTaskBasis(state: List<String>): VaultTask {
    require(state.size == 17) { "The saved task editor identity is incomplete." }
    return VaultTask(state[0], state[1], state[2], state[3], state[4], state[5].toBooleanStrict(),
        state[6], Json.parseToJsonElement(state[7]).jsonObject, state[8], state[9].toBooleanStrict(),
        state[10].toBooleanStrict(), state[11].toBooleanStrict(), state[12].toBooleanStrict(),
        state[13].toULong(), state[14].ifEmpty { null }, state[15].ifEmpty { null }, state[16].toBooleanStrict())
}

internal fun saveEditorIdentity(editor: Pair<String, VaultTask>): List<String> = listOf(editor.first) + saveTaskBasis(editor.second)

internal fun restoreEditorIdentity(state: List<String>): Pair<String, VaultTask> {
    require(state.size == 18 && state[0].isNotBlank()) { "The saved task editor has no owning vault." }
    return state[0] to restoreTaskBasis(state.drop(1))
}
