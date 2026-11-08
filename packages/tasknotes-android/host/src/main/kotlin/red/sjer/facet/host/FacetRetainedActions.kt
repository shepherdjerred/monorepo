package red.sjer.facet.host

import kotlinx.serialization.json.*

/** Historical private drafts remain readable, while execution keeps the public contract. */
internal object FacetRetainedActions {
    fun validate(schema: FacetSchema, mutation: JsonObject) = schema.validate("retainedMutation", mutation)

    fun canResume(mutation: JsonObject): Boolean = supported(mutation.getValue("command").jsonObject)

    fun retirement(schema: FacetSchema, draft: PendingFacetMutation, outcome: JsonObject): FacetDraftRetirement {
        validate(schema, draft.mutation)
        schema.validate("mutationReceipt", outcome)
        require(outcome.getValue("mutationId").jsonPrimitive.content == draft.mutationId)
        val observedReceipt = outcome.getValue("receipt")
        if (observedReceipt != JsonNull)
            require(observedReceipt.jsonObject.getValue("mutationId").jsonPrimitive.content == draft.mutationId)
        return when (outcome.getValue("state").jsonPrimitive.content) {
            "absent", "parked" -> FacetDraftRetirement.REJECTED
            "applied" -> {
                if (draft.canResume) throw FacetActionError("This action is already saved. Resume its original action before clearing its draft.")
                val receipt = outcome.getValue("receipt").jsonObject
                require(receipt.getValue("applied").jsonPrimitive.boolean)
                FacetDraftRetirement.OBSERVED
            }
            else -> throw FacetActionError("This action is still pending. Refresh the vault before checking its saved outcome again.")
        }
    }

    private fun supported(command: JsonObject): Boolean = when (command.getValue("kind").jsonPrimitive.content) {
        "start_time", "stop_time", "set_time_entries", "pomodoro" -> false
        "batch", "batch_partial" -> command.getValue("commands").jsonArray.all { supported(it.jsonObject) }
        else -> true
    }
}

internal enum class FacetDraftRetirement { REJECTED, OBSERVED }
