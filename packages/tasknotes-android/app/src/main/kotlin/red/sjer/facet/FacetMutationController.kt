package red.sjer.facet

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.boolean
import red.sjer.facet.host.FacetEngineRunner
import red.sjer.facet.host.PendingFacetMutation
import red.sjer.facet.host.FacetSchema
import red.sjer.facet.host.FacetNoticeOwner
import red.sjer.facet.host.FacetReceiptWarnings
import red.sjer.facet.host.FacetReceiptContractException

/** The native boundary retains envelopes and verifies applied receipts before returning. */
interface FacetMutationPort {
    suspend fun execute(profileId: String, command: JsonObject, mutationId: String): JsonObject
    suspend fun retry(mutationId: String): JsonObject
    suspend fun discardObserved(mutationId: String)
}

class NativeFacetMutationPort(private val engine: FacetEngineRunner) : FacetMutationPort {
    override suspend fun execute(profileId: String, command: JsonObject, mutationId: String) = engine.execute(profileId, command, mutationId)
    override suspend fun retry(mutationId: String) = engine.retryMutation(mutationId)
    override suspend fun discardObserved(mutationId: String) = engine.discardObservedMutation(mutationId)
}

data class AppliedFacetAction(val profileId: String, val mutationId: String, val receipt: JsonObject, val maintenanceRequired: Boolean, val warningMessages: List<String>, val observationPending: Boolean = false)

/** Presentation never substitutes selection for a saved action's owning vault. */
class FacetMutationController(private val port: FacetMutationPort, private val schema: FacetSchema) {
    suspend fun submit(profileId: String, command: JsonObject, mutationId: String, observed: suspend (JsonObject) -> Unit = {}): AppliedFacetAction =
        finish(profileId, mutationId, port.execute(profileId, command, mutationId), observed)

    suspend fun resume(action: PendingFacetMutation, observed: suspend (JsonObject) -> Unit = {}): AppliedFacetAction =
        finish(action.profileId, action.mutationId, port.retry(action.mutationId), observed)

    /** Payload mutations share the same validated observation and cleanup outcome. */
    suspend fun observeApplied(profileId: String, mutationId: String, receipt: JsonObject, observed: suspend (JsonObject) -> Unit = {}): AppliedFacetAction =
        finish(profileId, mutationId, receipt, observed)

    private suspend fun finish(profileId: String, mutationId: String, receipt: JsonObject, observed: suspend (JsonObject) -> Unit = {}): AppliedFacetAction {
        FacetReceiptWarnings.parse(schema, receipt.toString(), mutationId)
        if (!receipt.getValue("applied").jsonPrimitive.boolean)
            throw FacetReceiptContractException("The native boundary did not return this action's applied receipt.")
        val messages = FacetReceiptWarnings.read(schema, receipt.toString(), FacetNoticeOwner(profileId, mutationId, 0, 0))?.messages ?: emptyList()
        try { observed(receipt) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: java.io.IOException) {
            // Applied remains primary; retain the original envelope for cleanup recovery.
            return AppliedFacetAction(profileId, mutationId, receipt, true, messages, observationPending = true)
        }
        var maintenance = receipt.getValue("cleanupPending").jsonPrimitive.boolean
        try { port.discardObserved(mutationId) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: java.io.IOException) { maintenance = true }
        return AppliedFacetAction(profileId, mutationId, receipt, maintenance, messages)
    }
}
