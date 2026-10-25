package red.sjer.facet.host

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.*
import uniffi.TaskNotesCore.FacetEngineException

internal interface FacetAutomaticRecoveryBoundary {
    suspend fun retry(action: PendingFacetMutation, admitted: () -> Unit)
    suspend fun receipt(action: PendingFacetMutation): JsonObject
    suspend fun retire(action: PendingFacetMutation, admitted: () -> Unit)
    suspend fun observe(action: PendingFacetMutation)
}

internal enum class FacetAutomaticRecoveryOutcome { RESUMED, OBSERVED, RETIRED }

/** Recovery never rewrites an admitted envelope. Only proven terminal, obsolete automatic work gets a new plan. */
internal class FacetAutomaticRecovery(private val schema: FacetSchema, private val boundary: FacetAutomaticRecoveryBoundary) {
    suspend fun recover(action: PendingFacetMutation, active: () -> Boolean): FacetAutomaticRecoveryOutcome {
        require(isAutomaticOccurrenceCommand(action.mutation.getValue("command").jsonObject))
        FacetRetainedActions.validate(schema, action.mutation)
        currentCoroutineContext().ensureActive(); ensureOccurrenceOwner(active)
        var outcome = FacetAutomaticRecoveryOutcome.RESUMED
        try { boundary.retry(action) { ensureOccurrenceOwner(active) } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (!expectedOccurrenceFailure(failure)) throw failure
            ensureOccurrenceOwner(active)
            val proof = try { boundary.receipt(action) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (proofFailure: Exception) {
                if (!expectedOccurrenceFailure(proofFailure)) { proofFailure.addSuppressed(failure); throw proofFailure }
                failure.addSuppressed(proofFailure); throw failure
            }
            schema.validate("mutationReceipt", proof)
            require(proof.getValue("mutationId").jsonPrimitive.content == action.mutationId)
            ensureOccurrenceOwner(active)
            when (proof.getValue("state").jsonPrimitive.content) {
                "absent", "parked" -> {
                    // IO, provider, busy and storage failures remain uncertain even when a probe sees no journal.
                    if (failure !is FacetEngineException.Conflict && failure !is FacetActionError) throw failure
                    require(FacetRetainedActions.retirement(schema, action, proof) == FacetDraftRetirement.REJECTED)
                    try { boundary.retire(action) { ensureOccurrenceOwner(active) } }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (retirementFailure: Exception) {
                        // The engine rereads the receipt atomically with retirement. A pending/applied race keeps the draft.
                        if (!expectedOccurrenceFailure(retirementFailure)) { retirementFailure.addSuppressed(failure); throw retirementFailure }
                        failure.addSuppressed(retirementFailure); throw failure
                    }
                    return FacetAutomaticRecoveryOutcome.RETIRED
                }
                "applied" -> {
                    val receipt = proof.getValue("receipt").jsonObject
                    FacetReceiptWarnings.parse(schema, receipt.toString(), action.mutationId)
                    require(receipt.getValue("applied").jsonPrimitive.boolean)
                    outcome = FacetAutomaticRecoveryOutcome.OBSERVED
                }
                "pending" -> throw failure
                else -> error("Unknown automatic recovery receipt state.")
            }
        }
        ensureOccurrenceOwner(active)
        boundary.observe(action)
        return outcome
    }
}

internal fun isAutomaticOccurrenceCommand(command: JsonObject): Boolean =
    command["kind"]?.jsonPrimitive?.content == "materialize_occurrence_window" && command["origin"]?.jsonPrimitive?.content == "automatic_maintenance"
