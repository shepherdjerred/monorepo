using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests;

/// <summary>Native widgets consume typed core projections and never parse or build recurrence text.</summary>
[TestClass]
public sealed class RecurrenceControlDraftTests
{
    /// <summary>Gets the cooperative test cancellation context.</summary>
    public required TestContext TestContext { get; set; }

    /// <summary>Core-declined rules, unrepresented ordinal controls and out-of-range widget intervals remain raw-only.</summary>
    [TestMethod]
    [DataRow(0)]
    [DataRow(1)]
    [DataRow(2)]
    public async Task UnrepresentedProjectionsRefuseStructuredReplacement(int kind)
    {
        RecurrenceDraft? projected = kind switch
        {
            0 => null,
            1 => new(
                1,
                new RecurrencePattern.MonthlyOrdinalWeekday(
                    RecurrenceOrdinal.First,
                    DayOfWeek.Monday
                ),
                new RecurrenceEnd.Never()
            ),
            2 => new(1000, new RecurrencePattern.Daily(), new RecurrenceEnd.Never()),
            _ => throw new ArgumentOutOfRangeException(nameof(kind)),
        };
        var editor = new RecordingEditor();
        var draft = RecurrenceControlDraft.FromProjection(
            "unchanged-raw-rule",
            new("2026-10-03", projected)
        );
        Assert.IsFalse(draft.CanEdit);
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            draft.ApplyAsync(
                editor,
                RecurrenceFrequency.Monthly,
                2,
                [],
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual(0, editor.BuildCount);
        Assert.AreEqual(0, editor.PatternCount);
    }

    /// <summary>Unchanged native selections return authoritative source bytes without calling a builder.</summary>
    [TestMethod]
    [DataRow(RecurrenceFrequency.Daily, "FREQ=DAILY", 1)]
    [DataRow(RecurrenceFrequency.Weekly, "BYDAY=WE,MO;FREQ=WEEKLY;INTERVAL=2;COUNT=5", 2)]
    [DataRow(RecurrenceFrequency.Monthly, "INTERVAL=02;FREQ=MONTHLY;BYMONTHDAY=15", 2)]
    [DataRow(RecurrenceFrequency.Yearly, "FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=19;INTERVAL=2", 2)]
    public async Task UnchangedCoreProjectionKeepsExactBytes(
        RecurrenceFrequency frequency,
        string raw,
        int interval
    )
    {
        var editor = new RecordingEditor();
        RecurrenceEnd ending =
            frequency == RecurrenceFrequency.Weekly
                ? new RecurrenceEnd.AfterOccurrences(5)
                : new RecurrenceEnd.Never();
        var projection = new RecurrenceProjection(
            "2026-10-03",
            new(checked((uint)interval), Pattern(frequency), ending)
        );
        var draft = RecurrenceControlDraft.FromProjection(raw, projection);
        Assert.IsTrue(draft.CanEdit);
        Assert.AreEqual(
            raw,
            await draft.ApplyAsync(
                editor,
                frequency,
                interval,
                draft.Days.Reverse(),
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual(0, editor.BuildCount);
        Assert.AreEqual(0, editor.PatternCount);
    }

    /// <summary>Blank-to-Daily is explicit even when the core's initial draft already contains Daily.</summary>
    [TestMethod]
    public async Task BlankDailySelectionUsesCoreBuilder()
    {
        var editor = new RecordingEditor();
        var draft = RecurrenceControlDraft.FromProjection(
            null,
            new("2026-10-03", new(1, new RecurrencePattern.Daily(), new RecurrenceEnd.Never()))
        );
        Assert.IsNull(draft.Frequency);
        Assert.AreEqual(
            "core-built-rule",
            await draft.ApplyAsync(
                editor,
                RecurrenceFrequency.Daily,
                1,
                [],
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual(1, editor.BuildCount);
        Assert.IsInstanceOfType<RecurrencePattern.Daily>(editor.LastDraft!.Pattern);
        Assert.AreEqual("2026-10-03", editor.LastStart);
    }

    /// <summary>Interval edits retain typed weekly selectors, month/day selectors and the original ending.</summary>
    [TestMethod]
    [DataRow(RecurrenceFrequency.Weekly)]
    [DataRow(RecurrenceFrequency.Monthly)]
    [DataRow(RecurrenceFrequency.Yearly)]
    public async Task IntervalEditPreservesCoreSelectorsAndEnding(RecurrenceFrequency frequency)
    {
        var pattern = Pattern(frequency);
        var ending = new RecurrenceEnd.OnDate("2027-12-31");
        var editor = new RecordingEditor();
        var draft = RecurrenceControlDraft.FromProjection(
            "original-core-rule",
            new("2026-10-03", new(1, pattern, ending))
        );
        Assert.AreEqual(
            "core-built-rule",
            await draft.ApplyAsync(editor, frequency, 3, draft.Days, TestContext.CancellationToken)
        );
        Assert.AreEqual(3u, editor.LastDraft!.Interval);
        Assert.AreSame(ending, editor.LastDraft.Ending);
        if (pattern is RecurrencePattern.Weekly weekly)
            Assert.AreSequenceEqual(
                weekly.Weekdays,
                ((RecurrencePattern.Weekly)editor.LastDraft.Pattern).Weekdays
            );
        else
            Assert.AreSame(pattern, editor.LastDraft.Pattern);
        Assert.AreEqual(0, editor.PatternCount);
    }

    /// <summary>Explicit frequency changes use core-derived defaults, preserve endings and support clearing.</summary>
    [TestMethod]
    public async Task FrequencyChangesDelegateDefaultsAndPreserveEnding()
    {
        var ending = new RecurrenceEnd.AfterOccurrences(5);
        foreach (
            var frequency in new[]
            {
                RecurrenceFrequency.Daily,
                RecurrenceFrequency.Monthly,
                RecurrenceFrequency.Yearly,
            }
        )
        {
            var editor = new RecordingEditor();
            var draft = RecurrenceControlDraft.FromProjection(
                "weekly-source",
                new("2026-10-03", new(1, Pattern(RecurrenceFrequency.Weekly), ending))
            );
            Assert.AreEqual(
                "core-built-rule",
                await draft.ApplyAsync(editor, frequency, 2, [], TestContext.CancellationToken)
            );
            Assert.AreEqual(frequency, editor.LastFrequency);
            Assert.AreEqual(1, editor.PatternCount);
            Assert.AreSame(ending, editor.LastDraft!.Ending);
            Assert.IsNull(
                await draft.ApplyAsync(editor, null, 1, [], TestContext.CancellationToken)
            );
        }
        var weeklyEditor = new RecordingEditor();
        var blank = RecurrenceControlDraft.FromProjection(
            "",
            new("2026-10-03", new(1, new RecurrencePattern.Daily(), ending))
        );
        _ = await blank.ApplyAsync(
            weeklyEditor,
            RecurrenceFrequency.Weekly,
            1,
            [],
            TestContext.CancellationToken
        );
        Assert.AreSequenceEqual(
            new[] { DayOfWeek.Monday, DayOfWeek.Wednesday },
            ((RecurrencePattern.Weekly)weeklyEditor.LastDraft!.Pattern).Weekdays
        );
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            blank.ApplyAsync(
                weeklyEditor,
                RecurrenceFrequency.Daily,
                1.5,
                [],
                TestContext.CancellationToken
            )
        );
    }

    private static RecurrencePattern Pattern(RecurrenceFrequency frequency) =>
        frequency switch
        {
            RecurrenceFrequency.Daily => new RecurrencePattern.Daily(),
            RecurrenceFrequency.Weekly => new RecurrencePattern.Weekly([
                DayOfWeek.Monday,
                DayOfWeek.Wednesday,
            ]),
            RecurrenceFrequency.Monthly => new RecurrencePattern.MonthlyDayOfMonth(15),
            RecurrenceFrequency.Yearly => new RecurrencePattern.YearlyMonthDay(7, 19),
            _ => throw new ArgumentOutOfRangeException(nameof(frequency)),
        };

    private sealed class RecordingEditor : IRecurrenceEditor
    {
        internal int BuildCount { get; private set; }
        internal int PatternCount { get; private set; }
        internal RecurrenceDraft? LastDraft { get; private set; }
        internal string? LastStart { get; private set; }
        internal RecurrenceFrequency? LastFrequency { get; private set; }

        public Task<RecurrenceProjection> ProjectAsync(
            string rule,
            string? scheduled,
            string? dateCreated,
            string today,
            CancellationToken cancellationToken = default
        ) => throw new InvalidOperationException("This test supplies the typed core projection.");

        public Task<RecurrencePattern> PatternAsync(
            RecurrenceFrequency frequency,
            string start,
            CancellationToken cancellationToken = default
        )
        {
            PatternCount++;
            LastFrequency = frequency;
            LastStart = start;
            return Task.FromResult(Pattern(frequency));
        }

        public Task<string> BuildAsync(
            RecurrenceDraft draft,
            string start,
            CancellationToken cancellationToken = default
        )
        {
            BuildCount++;
            LastDraft = draft;
            LastStart = start;
            return Task.FromResult("core-built-rule");
        }
    }
}
