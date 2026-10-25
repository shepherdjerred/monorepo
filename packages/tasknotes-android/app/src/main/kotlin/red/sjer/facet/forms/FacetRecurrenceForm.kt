package red.sjer.facet

import java.io.Serializable
import red.sjer.facet.host.FacetActionError
import red.sjer.facet.host.FacetRepeatDraft
import red.sjer.facet.host.FacetRepeatEnd
import red.sjer.facet.host.FacetRepeatPattern
import red.sjer.facet.host.FacetRepeatProjection

/** Serializable only as this app's own Android saved form state, never as vault data. */
internal data class FacetRecurrenceForm(
    val original: String,
    val start: String,
    val draft: FacetRepeatDraft?,
    val interval: String,
    val endDate: String,
    val count: String,
    val raw: String,
    val advanced: Boolean,
    val changed: Boolean = false,
) : Serializable {
    val frequency: String? get() = when (draft?.pattern) {
        FacetRepeatPattern.Daily -> "DAILY"
        is FacetRepeatPattern.Weekly -> "WEEKLY"
        is FacetRepeatPattern.MonthlyDay, is FacetRepeatPattern.MonthlyWeekday -> "MONTHLY"
        is FacetRepeatPattern.Yearly -> "YEARLY"
        null -> null
    }
    val selectedFrequency: String? get() = if (original.isEmpty() && !changed) null else frequency
    val valid: Boolean get() {
        if (advanced || !changed) return true
        val current = draft ?: return false
        val pattern = current.pattern
        val ending = current.ending
        return interval.toUIntOrNull()?.let { it > 0u } == true &&
            (pattern !is FacetRepeatPattern.Weekly || pattern.weekdays.isNotEmpty()) &&
            (ending !is FacetRepeatEnd.AfterOccurrences || count.toUIntOrNull()?.let { it > 0u } == true) &&
            (ending !is FacetRepeatEnd.OnDate || endDate.isNotBlank())
    }

    fun withPattern(pattern: FacetRepeatPattern): FacetRecurrenceForm = copy(draft = checkNotNull(draft).copy(pattern = pattern), changed = true)
    fun selectFrequency(pattern: FacetRepeatPattern): FacetRecurrenceForm =
        if (original.isNotEmpty() && draft?.pattern == pattern) this else withPattern(pattern)

    suspend fun changeToApply(build: suspend (FacetRepeatDraft, String) -> String): String? = when {
        !changed -> null
        advanced -> raw
        else -> build(buildDraft(), start)
    }

    fun withEnding(ending: FacetRepeatEnd): FacetRecurrenceForm = copy(
        draft = checkNotNull(draft).copy(ending = ending),
        endDate = (ending as? FacetRepeatEnd.OnDate)?.date.orEmpty(),
        count = (ending as? FacetRepeatEnd.AfterOccurrences)?.count?.toString() ?: "1",
        changed = true,
    )
    fun buildDraft(): FacetRepeatDraft {
        val current = checkNotNull(draft)
        val every = interval.toUIntOrNull()?.takeIf { it > 0u } ?: throw FacetActionError("Enter a positive repeat interval.")
        val ending = when (current.ending) {
            FacetRepeatEnd.Never -> FacetRepeatEnd.Never
            is FacetRepeatEnd.OnDate -> FacetRepeatEnd.OnDate(endDate)
            is FacetRepeatEnd.AfterOccurrences -> FacetRepeatEnd.AfterOccurrences(
                count.toUIntOrNull()?.takeIf { it > 0u } ?: throw FacetActionError("Enter a positive occurrence count."))
        }
        return current.copy(interval = every, ending = ending)
    }

    companion object {
        fun from(rule: String, projection: FacetRepeatProjection) = FacetRecurrenceForm(
            original = rule, start = projection.start, draft = projection.draft,
            interval = projection.draft?.interval?.toString() ?: "1",
            endDate = (projection.draft?.ending as? FacetRepeatEnd.OnDate)?.date.orEmpty(),
            count = (projection.draft?.ending as? FacetRepeatEnd.AfterOccurrences)?.count?.toString() ?: "1",
            raw = rule, advanced = projection.draft == null,
        )
    }
}
