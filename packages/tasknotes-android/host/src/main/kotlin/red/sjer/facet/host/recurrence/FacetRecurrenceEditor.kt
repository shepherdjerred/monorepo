package red.sjer.facet.host

import java.io.Serializable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.TaskNotesCore.CommonRecurrenceDraft
import uniffi.TaskNotesCore.CommonRecurrenceEnd
import uniffi.TaskNotesCore.CommonRecurrencePattern
import uniffi.TaskNotesCore.CommonWeekday
import uniffi.TaskNotesCore.CoreException
import uniffi.TaskNotesCore.MonthlyOrdinal

/** Portable form values; generated FFI members stay inside the host. */
enum class FacetRepeatWeekday(val label: String) { MONDAY("Mon"), TUESDAY("Tue"), WEDNESDAY("Wed"), THURSDAY("Thu"), FRIDAY("Fri"), SATURDAY("Sat"), SUNDAY("Sun") }
enum class FacetRepeatOrdinal(val label: String) { FIRST("first"), SECOND("second"), THIRD("third"), FOURTH("fourth"), FIFTH("fifth"), LAST("last") }

sealed interface FacetRepeatPattern : Serializable {
    data object Daily : FacetRepeatPattern
    data class Weekly(val weekdays: List<FacetRepeatWeekday>) : FacetRepeatPattern
    data class MonthlyDay(val day: UByte) : FacetRepeatPattern
    data class MonthlyWeekday(val ordinal: FacetRepeatOrdinal, val weekday: FacetRepeatWeekday) : FacetRepeatPattern
    data class Yearly(val month: UByte, val day: UByte) : FacetRepeatPattern
}
sealed interface FacetRepeatEnd : Serializable {
    data object Never : FacetRepeatEnd
    data class OnDate(val date: String) : FacetRepeatEnd
    data class AfterOccurrences(val count: UInt) : FacetRepeatEnd
}
data class FacetRepeatDraft(val interval: UInt, val pattern: FacetRepeatPattern, val ending: FacetRepeatEnd) : Serializable
data class FacetRepeatProjection(val start: String, val draft: FacetRepeatDraft?)

internal interface FacetRecurrenceCore {
    fun resolvedStart(rule: String, scheduled: String?, created: String?): String?
    fun parse(rule: String, start: String): CommonRecurrenceDraft?
    fun build(draft: CommonRecurrenceDraft, start: String): String
}
private object NativeRecurrenceCore : FacetRecurrenceCore {
    override fun resolvedStart(rule: String, scheduled: String?, created: String?) = uniffi.TaskNotesCore.recurrenceResolvedStart(rule, scheduled, created)
    override fun parse(rule: String, start: String) = uniffi.TaskNotesCore.recurrenceParseCommon(rule, start)
    override fun build(draft: CommonRecurrenceDraft, start: String) = uniffi.TaskNotesCore.recurrenceBuildCommon(draft, start)
}

/** These pure core calls run off Main and do not consult or mutate any selected vault. */
class FacetRecurrenceEditor internal constructor(private val core: FacetRecurrenceCore) {
    suspend fun project(rule: String, scheduled: String?, created: String?, today: String): FacetRepeatProjection = withContext(Dispatchers.Default) {
        val resolved = core.resolvedStart(rule, scheduled, created)
        val start = resolved ?: today
        // An unresolved existing anchor cannot be truthfully translated into common controls.
        val parsed = if (rule.isEmpty()) core.parse("FREQ=DAILY", start)
            else if (resolved != null) core.parse(rule, start) else null
        FacetRepeatProjection(start, parsed?.let(::fromCore))
    }

    suspend fun pattern(frequency: String, start: String): FacetRepeatPattern = withContext(Dispatchers.Default) {
        require(frequency in setOf("DAILY", "WEEKLY", "MONTHLY", "YEARLY"))
        fromCore(checkNotNull(core.parse("FREQ=$frequency", start)) { "The core rejected a supported common pattern." }).pattern
    }

    suspend fun build(draft: FacetRepeatDraft, start: String): String = withContext(Dispatchers.Default) {
        try { core.build(toCore(draft), start) }
        catch (failure: CoreException.Validation) { throw FacetActionError(failure.detail) }
    }

    companion object { val shared = FacetRecurrenceEditor(NativeRecurrenceCore) }
}

private fun weekday(value: CommonWeekday): FacetRepeatWeekday = when (value) {
    CommonWeekday.MONDAY -> FacetRepeatWeekday.MONDAY
    CommonWeekday.TUESDAY -> FacetRepeatWeekday.TUESDAY
    CommonWeekday.WEDNESDAY -> FacetRepeatWeekday.WEDNESDAY
    CommonWeekday.THURSDAY -> FacetRepeatWeekday.THURSDAY
    CommonWeekday.FRIDAY -> FacetRepeatWeekday.FRIDAY
    CommonWeekday.SATURDAY -> FacetRepeatWeekday.SATURDAY
    CommonWeekday.SUNDAY -> FacetRepeatWeekday.SUNDAY
}
private fun weekday(value: FacetRepeatWeekday): CommonWeekday = when (value) {
    FacetRepeatWeekday.MONDAY -> CommonWeekday.MONDAY
    FacetRepeatWeekday.TUESDAY -> CommonWeekday.TUESDAY
    FacetRepeatWeekday.WEDNESDAY -> CommonWeekday.WEDNESDAY
    FacetRepeatWeekday.THURSDAY -> CommonWeekday.THURSDAY
    FacetRepeatWeekday.FRIDAY -> CommonWeekday.FRIDAY
    FacetRepeatWeekday.SATURDAY -> CommonWeekday.SATURDAY
    FacetRepeatWeekday.SUNDAY -> CommonWeekday.SUNDAY
}
private fun ordinal(value: MonthlyOrdinal): FacetRepeatOrdinal = when (value) {
    MonthlyOrdinal.FIRST -> FacetRepeatOrdinal.FIRST
    MonthlyOrdinal.SECOND -> FacetRepeatOrdinal.SECOND
    MonthlyOrdinal.THIRD -> FacetRepeatOrdinal.THIRD
    MonthlyOrdinal.FOURTH -> FacetRepeatOrdinal.FOURTH
    MonthlyOrdinal.FIFTH -> FacetRepeatOrdinal.FIFTH
    MonthlyOrdinal.LAST -> FacetRepeatOrdinal.LAST
}
private fun ordinal(value: FacetRepeatOrdinal): MonthlyOrdinal = when (value) {
    FacetRepeatOrdinal.FIRST -> MonthlyOrdinal.FIRST
    FacetRepeatOrdinal.SECOND -> MonthlyOrdinal.SECOND
    FacetRepeatOrdinal.THIRD -> MonthlyOrdinal.THIRD
    FacetRepeatOrdinal.FOURTH -> MonthlyOrdinal.FOURTH
    FacetRepeatOrdinal.FIFTH -> MonthlyOrdinal.FIFTH
    FacetRepeatOrdinal.LAST -> MonthlyOrdinal.LAST
}
private fun fromCore(value: CommonRecurrenceDraft) = FacetRepeatDraft(value.interval, when (val pattern = value.pattern) {
    CommonRecurrencePattern.Daily -> FacetRepeatPattern.Daily
    is CommonRecurrencePattern.Weekly -> FacetRepeatPattern.Weekly(pattern.weekdays.map(::weekday))
    is CommonRecurrencePattern.MonthlyDayOfMonth -> FacetRepeatPattern.MonthlyDay(pattern.day)
    is CommonRecurrencePattern.MonthlyOrdinalWeekday -> FacetRepeatPattern.MonthlyWeekday(ordinal(pattern.ordinal), weekday(pattern.weekday))
    is CommonRecurrencePattern.YearlyMonthDay -> FacetRepeatPattern.Yearly(pattern.month, pattern.day)
}, when (val ending = value.ending) {
    CommonRecurrenceEnd.Never -> FacetRepeatEnd.Never
    is CommonRecurrenceEnd.OnDate -> FacetRepeatEnd.OnDate(ending.v1)
    is CommonRecurrenceEnd.AfterOccurrences -> FacetRepeatEnd.AfterOccurrences(ending.v1)
})
private fun toCore(value: FacetRepeatDraft) = CommonRecurrenceDraft(value.interval, when (val pattern = value.pattern) {
    FacetRepeatPattern.Daily -> CommonRecurrencePattern.Daily
    is FacetRepeatPattern.Weekly -> CommonRecurrencePattern.Weekly(pattern.weekdays.map(::weekday))
    is FacetRepeatPattern.MonthlyDay -> CommonRecurrencePattern.MonthlyDayOfMonth(pattern.day)
    is FacetRepeatPattern.MonthlyWeekday -> CommonRecurrencePattern.MonthlyOrdinalWeekday(ordinal(pattern.ordinal), weekday(pattern.weekday))
    is FacetRepeatPattern.Yearly -> CommonRecurrencePattern.YearlyMonthDay(pattern.month, pattern.day)
}, when (val ending = value.ending) {
    FacetRepeatEnd.Never -> CommonRecurrenceEnd.Never
    is FacetRepeatEnd.OnDate -> CommonRecurrenceEnd.OnDate(ending.date)
    is FacetRepeatEnd.AfterOccurrences -> CommonRecurrenceEnd.AfterOccurrences(ending.count)
})
