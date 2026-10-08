package red.sjer.facet

import kotlinx.serialization.json.*

/** A single durable record commits the stack and the observed decision together. */
data class FacetUndoHistory(val receipts: List<String> = emptyList(), val observed: Set<String> = emptySet(), val resolutions: List<String> = emptyList()) {
    fun reconcile(mutationId: String, command: JsonObject): FacetUndoHistory {
        if (mutationId in observed) return this
        val kind = command.getValue("kind").jsonPrimitive.content
        if (kind != "undo" && kind != "resolve_conflict" && !completion(command)) return this
        val next = receipts.toMutableList()
        when {
            kind == "undo" -> {
                val receiptId = command.getValue("receiptId").jsonPrimitive.content
                if (receiptId in next) {
                    check(next.lastOrNull() == receiptId) { "The saved Undo action does not match the durable history head." }
                    next.removeAt(next.lastIndex)
                }
            }
            (completion(command) || kind == "resolve_conflict") && mutationId !in next -> next.add(mutationId)
        }
        return FacetUndoHistory(next, observed + mutationId, if (kind == "resolve_conflict") resolutions + mutationId else resolutions)
    }

    fun document(): JsonObject = buildJsonObject { put("receipts", strings(receipts)); put("observed", strings(observed.sorted())); put("resolutions", strings(resolutions)) }

    companion object {
        fun read(document: JsonObject): FacetUndoHistory = FacetUndoHistory(
            document.getValue("receipts").jsonArray.map { it.jsonPrimitive.content },
            document.getValue("observed").jsonArray.map { it.jsonPrimitive.content }.toSet(),
            document["resolutions"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList(),
        )
        private fun completion(command: JsonObject): Boolean = when (command.getValue("kind").jsonPrimitive.content) {
            "set_completion" -> true
            "batch" -> command.getValue("commands").jsonArray.any { completion(it.jsonObject) }
            else -> false
        }
    }
}
