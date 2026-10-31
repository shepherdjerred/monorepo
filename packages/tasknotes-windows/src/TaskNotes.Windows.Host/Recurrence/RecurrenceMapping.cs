using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host;

internal static class RecurrenceMapping
{
    internal static RecurrenceDraft FromCore(Core.CommonRecurrenceDraft draft) =>
        new(
            draft.Interval,
            draft.Pattern switch
            {
                Core.CommonRecurrencePattern.Daily => new RecurrencePattern.Daily(),
                Core.CommonRecurrencePattern.Weekly pattern => new RecurrencePattern.Weekly([
                    .. pattern.Weekdays.Select(FromCore),
                ]),
                Core.CommonRecurrencePattern.MonthlyDayOfMonth pattern =>
                    new RecurrencePattern.MonthlyDayOfMonth(pattern.Day),
                Core.CommonRecurrencePattern.MonthlyOrdinalWeekday pattern =>
                    new RecurrencePattern.MonthlyOrdinalWeekday(
                        FromCore(pattern.Ordinal),
                        FromCore(pattern.Weekday)
                    ),
                Core.CommonRecurrencePattern.YearlyMonthDay pattern =>
                    new RecurrencePattern.YearlyMonthDay(pattern.Month, pattern.Day),
                _ => throw new InvalidOperationException("Unknown core common recurrence pattern."),
            },
            draft.Ending switch
            {
                Core.CommonRecurrenceEnd.Never => new RecurrenceEnd.Never(),
                Core.CommonRecurrenceEnd.OnDate ending => new RecurrenceEnd.OnDate(ending.V1),
                Core.CommonRecurrenceEnd.AfterOccurrences ending =>
                    new RecurrenceEnd.AfterOccurrences(ending.V1),
                _ => throw new InvalidOperationException("Unknown core common recurrence ending."),
            }
        );

    internal static Core.CommonRecurrenceDraft ToCore(RecurrenceDraft draft) =>
        new(
            draft.Interval,
            draft.Pattern switch
            {
                RecurrencePattern.Daily => new Core.CommonRecurrencePattern.Daily(),
                RecurrencePattern.Weekly pattern => new Core.CommonRecurrencePattern.Weekly([
                    .. pattern.Weekdays.Select(ToCore),
                ]),
                RecurrencePattern.MonthlyDayOfMonth pattern =>
                    new Core.CommonRecurrencePattern.MonthlyDayOfMonth(pattern.Day),
                RecurrencePattern.MonthlyOrdinalWeekday pattern =>
                    new Core.CommonRecurrencePattern.MonthlyOrdinalWeekday(
                        ToCore(pattern.Ordinal),
                        ToCore(pattern.Weekday)
                    ),
                RecurrencePattern.YearlyMonthDay pattern =>
                    new Core.CommonRecurrencePattern.YearlyMonthDay(pattern.Month, pattern.Day),
                _ => throw new InvalidOperationException(
                    "Unknown portable common recurrence pattern."
                ),
            },
            draft.Ending switch
            {
                RecurrenceEnd.Never => new Core.CommonRecurrenceEnd.Never(),
                RecurrenceEnd.OnDate ending => new Core.CommonRecurrenceEnd.OnDate(ending.Date),
                RecurrenceEnd.AfterOccurrences ending =>
                    new Core.CommonRecurrenceEnd.AfterOccurrences(ending.Count),
                _ => throw new InvalidOperationException(
                    "Unknown portable common recurrence ending."
                ),
            }
        );

    private static DayOfWeek FromCore(Core.CommonWeekday weekday) =>
        weekday switch
        {
            Core.CommonWeekday.Monday => DayOfWeek.Monday,
            Core.CommonWeekday.Tuesday => DayOfWeek.Tuesday,
            Core.CommonWeekday.Wednesday => DayOfWeek.Wednesday,
            Core.CommonWeekday.Thursday => DayOfWeek.Thursday,
            Core.CommonWeekday.Friday => DayOfWeek.Friday,
            Core.CommonWeekday.Saturday => DayOfWeek.Saturday,
            Core.CommonWeekday.Sunday => DayOfWeek.Sunday,
            _ => throw new InvalidOperationException("Unknown core recurrence weekday."),
        };

    private static Core.CommonWeekday ToCore(DayOfWeek weekday) =>
        weekday switch
        {
            DayOfWeek.Monday => Core.CommonWeekday.Monday,
            DayOfWeek.Tuesday => Core.CommonWeekday.Tuesday,
            DayOfWeek.Wednesday => Core.CommonWeekday.Wednesday,
            DayOfWeek.Thursday => Core.CommonWeekday.Thursday,
            DayOfWeek.Friday => Core.CommonWeekday.Friday,
            DayOfWeek.Saturday => Core.CommonWeekday.Saturday,
            DayOfWeek.Sunday => Core.CommonWeekday.Sunday,
            _ => throw new InvalidOperationException("Unknown portable recurrence weekday."),
        };

    private static RecurrenceOrdinal FromCore(Core.MonthlyOrdinal ordinal) =>
        ordinal switch
        {
            Core.MonthlyOrdinal.First => RecurrenceOrdinal.First,
            Core.MonthlyOrdinal.Second => RecurrenceOrdinal.Second,
            Core.MonthlyOrdinal.Third => RecurrenceOrdinal.Third,
            Core.MonthlyOrdinal.Fourth => RecurrenceOrdinal.Fourth,
            Core.MonthlyOrdinal.Fifth => RecurrenceOrdinal.Fifth,
            Core.MonthlyOrdinal.Last => RecurrenceOrdinal.Last,
            _ => throw new InvalidOperationException("Unknown core recurrence ordinal."),
        };

    private static Core.MonthlyOrdinal ToCore(RecurrenceOrdinal ordinal) =>
        ordinal switch
        {
            RecurrenceOrdinal.First => Core.MonthlyOrdinal.First,
            RecurrenceOrdinal.Second => Core.MonthlyOrdinal.Second,
            RecurrenceOrdinal.Third => Core.MonthlyOrdinal.Third,
            RecurrenceOrdinal.Fourth => Core.MonthlyOrdinal.Fourth,
            RecurrenceOrdinal.Fifth => Core.MonthlyOrdinal.Fifth,
            RecurrenceOrdinal.Last => Core.MonthlyOrdinal.Last,
            _ => throw new InvalidOperationException("Unknown portable recurrence ordinal."),
        };
}
