package red.sjer.facet.host

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Native owner captured before admission; no task content is included. */
data class FacetNoticeOwner(val profileId: String, val mutationId: String, val requestGeneration: Long, val engineGeneration: Long)

/** Saved presentation stays independent of maintenance or mutation failure. */
data class FacetSavedNotice(val owner: FacetNoticeOwner, val messages: List<String>) {
    val title: String get() = "Saved"
    fun belongsTo(current: FacetNoticeOwner): Boolean = owner == current
}

/** Malformed native receipts are internal contract failures, never draft retry advice. */
class FacetReceiptContractException(message: String, cause: Throwable? = null) : IllegalArgumentException(message, cause)

/** Required closed codes follow full validation using Rust's shared schema. */
object FacetReceiptWarnings {
    fun read(schema: FacetSchema, receiptJson: String, owner: FacetNoticeOwner): FacetSavedNotice? = checked {
        val receipt = parse(schema, receiptJson, owner.mutationId)
        val diagnostics = receipt.getValue("diagnostics")
        require(diagnostics is JsonArray && diagnostics.size <= 3) { "The native warning contract is invalid." }
        val seen = mutableSetOf<String>()
        val messages = diagnostics.map { item ->
            require(item is JsonObject && item.keys == setOf("code")) { "The native warning contract is invalid." }
            val code = item.getValue("code")
            require(code is JsonPrimitive && code.isString && seen.add(code.content)) { "The native warning contract is invalid." }
            when (code.content) {
                "template_missing" -> "The task was saved without the configured template."
                "template_parse_failed" -> "The configured template could not be used."
                "filename_shortened" -> "Facet shortened the filename and kept the full title."
                else -> error("The native warning code is unknown.")
            }
        }
        if (receipt.getValue("applied").jsonPrimitive.boolean && messages.isNotEmpty()) FacetSavedNotice(owner, messages) else null
    }

    /** Preserve raw duplicate-key rejection before any receipt field extraction. */
    fun parse(schema: FacetSchema, receiptJson: String, mutationId: String): JsonObject = checked {
        val receipt = FacetRawJson.parseObject(receiptJson)
        schema.validate("receipt", receipt)
        require(receipt.getValue("mutationId").jsonPrimitive.content == mutationId) { "The native receipt belongs to another action." }
        FacetContract.validateVersion(receipt)
        receipt
    }

    private inline fun <T> checked(read: () -> T): T = try {
        read()
    } catch (failure: FacetReceiptContractException) {
        throw failure
    } catch (failure: IllegalArgumentException) {
        throw FacetReceiptContractException("The native receipt does not match the action contract.", failure)
    } catch (failure: IllegalStateException) {
        throw FacetReceiptContractException("The native receipt has an invalid contract field.", failure)
    } catch (failure: NoSuchElementException) {
        throw FacetReceiptContractException("The native receipt is missing a required contract field.", failure)
    }
}
