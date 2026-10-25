using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests;

/// <summary>Exercises the real Rust common recurrence boundary through the portable native worker.</summary>
[TestClass]
public sealed class RecurrenceEditorTests
{
    private const string Start = "2026-10-05";
    private readonly CoreRecurrenceEditor _editor = new();

    /// <summary>Gets or sets the MSTest execution context.</summary>
    public required TestContext TestContext { get; set; }

    /// <summary>Retains every weekly selector and the count while changing only the interval.</summary>
    [TestMethod]
    public async Task WeeklyIntervalEditPreservesCoreWeekdaysAndCount()
    {
        RecurrenceProjection projection = await ProjectAsync(
            "BYDAY=WE,MO;COUNT=10;INTERVAL=2;FREQ=WEEKLY"
        );
        Assert.AreEqual(Start, projection.Start);
        RecurrenceDraft draft = Assert.IsInstanceOfType<RecurrenceDraft>(projection.Draft);
        RecurrencePattern.Weekly weekly = Assert.IsInstanceOfType<RecurrencePattern.Weekly>(
            draft.Pattern
        );
        Assert.AreSequenceEqual([DayOfWeek.Monday, DayOfWeek.Wednesday], weekly.Weekdays);
        Assert.AreEqual(new RecurrenceEnd.AfterOccurrences(10), draft.Ending);
        Assert.AreEqual(
            "FREQ=WEEKLY;INTERVAL=3;BYDAY=MO,WE;COUNT=10",
            await _editor.BuildAsync(
                draft with
                {
                    Interval = 3,
                },
                projection.Start,
                TestContext.CancellationToken
            )
        );
    }

    /// <summary>Round-trips all common pattern variants and all ending variants through Rust.</summary>
    [TestMethod]
    public async Task EveryCommonPatternAndEndingRoundTripsThroughTheNativeBoundary()
    {
        (RecurrenceDraft Draft, string Rule)[] cases =
        [
            (new(1, new RecurrencePattern.Daily(), new RecurrenceEnd.Never()), "FREQ=DAILY"),
            (
                new(
                    2,
                    new RecurrencePattern.Weekly([DayOfWeek.Monday, DayOfWeek.Friday]),
                    new RecurrenceEnd.AfterOccurrences(7)
                ),
                "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=7"
            ),
            (
                new(1, new RecurrencePattern.MonthlyDayOfMonth(31), new RecurrenceEnd.Never()),
                "FREQ=MONTHLY;BYMONTHDAY=31"
            ),
            (
                new(
                    1,
                    new RecurrencePattern.MonthlyOrdinalWeekday(
                        RecurrenceOrdinal.Last,
                        DayOfWeek.Friday
                    ),
                    new RecurrenceEnd.Never()
                ),
                "FREQ=MONTHLY;BYDAY=-1FR"
            ),
            (
                new(
                    1,
                    new RecurrencePattern.YearlyMonthDay(2, 29),
                    new RecurrenceEnd.OnDate("2032-02-29")
                ),
                "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;UNTIL=20320229"
            ),
        ];
        foreach (var (draft, rule) in cases)
        {
            Assert.AreEqual(
                rule,
                await _editor.BuildAsync(draft, Start, TestContext.CancellationToken)
            );
            RecurrenceDraft parsed = Assert.IsInstanceOfType<RecurrenceDraft>(
                (await ProjectAsync(rule)).Draft
            );
            Assert.AreEqual(draft.Interval, parsed.Interval);
            Assert.AreEqual(draft.Ending, parsed.Ending);
            Assert.AreEqual(
                rule,
                await _editor.BuildAsync(parsed, Start, TestContext.CancellationToken)
            );
        }
    }

    /// <summary>Uses Rust defaults instead of interpreting the anchor's weekday, month or day in C#.</summary>
    [TestMethod]
    public async Task PatternDefaultsComeFromTheCoreResolvedAnchor()
    {
        Assert.AreEqual(
            new RecurrencePattern.Daily(),
            await _editor.PatternAsync(
                RecurrenceFrequency.Daily,
                Start,
                TestContext.CancellationToken
            )
        );
        RecurrencePattern.Weekly weekly = Assert.IsInstanceOfType<RecurrencePattern.Weekly>(
            await _editor.PatternAsync(
                RecurrenceFrequency.Weekly,
                Start,
                TestContext.CancellationToken
            )
        );
        Assert.AreSequenceEqual([DayOfWeek.Monday], weekly.Weekdays);
        Assert.AreEqual(
            new RecurrencePattern.MonthlyDayOfMonth(5),
            await _editor.PatternAsync(
                RecurrenceFrequency.Monthly,
                Start,
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual(
            new RecurrencePattern.YearlyMonthDay(10, 5),
            await _editor.PatternAsync(
                RecurrenceFrequency.Yearly,
                Start,
                TestContext.CancellationToken
            )
        );
    }

    /// <summary>Keeps unsupported constraints raw instead of translating them into a lossy draft.</summary>
    [TestMethod]
    [DataRow("FREQ=DAILY;BYDAY=MO,WE")]
    [DataRow("FREQ=YEARLY;BYWEEKNO=20")]
    [DataRow("DTSTART:20261005T090000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=7")]
    public async Task CoreDeclinedRulesRemainRawOnly(string rule)
    {
        Assert.IsNull((await ProjectAsync(rule)).Draft);
    }

    /// <summary>Retains an existing rule without inventing an anchor; a new rule can use the caller's day.</summary>
    [TestMethod]
    public async Task UnresolvedExistingStartStaysRawWhileAnEmptyRuleGetsCoreDefaults()
    {
        RecurrenceProjection existing = await _editor.ProjectAsync(
            "FREQ=WEEKLY",
            null,
            null,
            Start,
            TestContext.CancellationToken
        );
        Assert.AreEqual(Start, existing.Start);
        Assert.IsNull(existing.Draft);
        RecurrenceProjection empty = await _editor.ProjectAsync(
            "",
            null,
            null,
            Start,
            TestContext.CancellationToken
        );
        RecurrenceDraft emptyDraft = Assert.IsInstanceOfType<RecurrenceDraft>(empty.Draft);
        Assert.AreEqual(new RecurrencePattern.Daily(), emptyDraft.Pattern);
        Assert.AreEqual(
            "FREQ=DAILY",
            await _editor.BuildAsync(emptyDraft, empty.Start, TestContext.CancellationToken)
        );
    }

    /// <summary>Seeds a newly repeating task from its scheduled day instead of the current day.</summary>
    [TestMethod]
    public async Task NewRuleUsesScheduledAnchorForWeeklyAndCalendarDefaults()
    {
        RecurrenceProjection projection = await _editor.ProjectAsync(
            "",
            "2026-10-06",
            "2026-10-07T12:00:00Z",
            Start,
            TestContext.CancellationToken
        );
        await AssertTuesdayStartAndWeeklyPatternAsync(projection);
        Assert.AreEqual(
            new RecurrencePattern.MonthlyDayOfMonth(6),
            await _editor.PatternAsync(
                RecurrenceFrequency.Monthly,
                projection.Start,
                TestContext.CancellationToken
            )
        );
        Assert.AreEqual(
            new RecurrencePattern.YearlyMonthDay(10, 6),
            await _editor.PatternAsync(
                RecurrenceFrequency.Yearly,
                projection.Start,
                TestContext.CancellationToken
            )
        );
    }

    /// <summary>Uses Rust's created-date fallback when a new task has no scheduled value.</summary>
    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    public async Task NewRuleUsesCreatedAnchorWhenScheduledIsMissing(string? scheduled)
    {
        RecurrenceProjection projection = await _editor.ProjectAsync(
            "",
            scheduled,
            "2026-10-06T12:00:00Z",
            Start,
            TestContext.CancellationToken
        );
        await AssertTuesdayStartAndWeeklyPatternAsync(projection);
    }

    /// <summary>Retains Rust's fail-closed scheduled-date behavior instead of trying a later fallback.</summary>
    [TestMethod]
    [DataRow("")]
    [DataRow("FREQ=WEEKLY")]
    public async Task InvalidAnchorsDoNotFallThroughToCreatedOrToday(string rule)
    {
        RecurrenceProjection projection = await _editor.ProjectAsync(
            rule,
            "not-a-date",
            "2026-10-06T12:00:00Z",
            Start,
            TestContext.CancellationToken
        );
        Assert.IsNull(projection.Draft);
    }

    /// <summary>Does not manufacture a new repeat schedule from an unreadable provided creation date.</summary>
    [TestMethod]
    public async Task InvalidCreatedAnchorRemainsRawOnlyForANewRule()
    {
        RecurrenceProjection projection = await _editor.ProjectAsync(
            "",
            null,
            "not-a-date",
            Start,
            TestContext.CancellationToken
        );
        Assert.IsNull(projection.Draft);
    }

    /// <summary>Lets the core choose scheduled over created, and created over the caller's day.</summary>
    [TestMethod]
    public async Task EffectiveStartPrecedenceComesFromRust()
    {
        RecurrenceProjection scheduled = await _editor.ProjectAsync(
            "FREQ=WEEKLY",
            "2026-10-07",
            "2026-10-06T12:00:00Z",
            Start,
            TestContext.CancellationToken
        );
        Assert.AreEqual("2026-10-07", scheduled.Start);
        RecurrencePattern.Weekly scheduledPattern =
            Assert.IsInstanceOfType<RecurrencePattern.Weekly>(
                Assert.IsInstanceOfType<RecurrenceDraft>(scheduled.Draft).Pattern
            );
        Assert.AreSequenceEqual([DayOfWeek.Wednesday], scheduledPattern.Weekdays);
        RecurrenceProjection created = await _editor.ProjectAsync(
            "FREQ=WEEKLY",
            null,
            "2026-10-06T12:00:00Z",
            Start,
            TestContext.CancellationToken
        );
        Assert.AreEqual("2026-10-06", created.Start);
        Assert.AreSequenceEqual(
            [DayOfWeek.Tuesday],
            Assert
                .IsInstanceOfType<RecurrencePattern.Weekly>(
                    Assert.IsInstanceOfType<RecurrenceDraft>(created.Draft).Pattern
                )
                .Weekdays
        );
    }

    /// <summary>Retains every weekday and ordinal discriminant through the actual native serialization.</summary>
    [TestMethod]
    public async Task EveryOrdinalAndWeekdaySurvivesThePortableMapping()
    {
        foreach (RecurrenceOrdinal ordinal in Enum.GetValues<RecurrenceOrdinal>())
        foreach (DayOfWeek weekday in Enum.GetValues<DayOfWeek>())
        {
            RecurrenceDraft draft = new(
                1,
                new RecurrencePattern.MonthlyOrdinalWeekday(ordinal, weekday),
                new RecurrenceEnd.Never()
            );
            string rule = await _editor.BuildAsync(draft, Start, TestContext.CancellationToken);
            Assert.AreEqual(
                draft,
                Assert.IsInstanceOfType<RecurrenceDraft>((await ProjectAsync(rule)).Draft)
            );
        }
    }

    /// <summary>Preserves a useful expected Rust validation failure rather than accepting an invalid draft.</summary>
    [TestMethod]
    public async Task InvalidCommonDraftKeepsTheCoreValidationExplanation()
    {
        Core.CoreException.Validation failure =
            await Assert.ThrowsExactlyAsync<Core.CoreException.Validation>(() =>
                _editor.BuildAsync(
                    new(0, new RecurrencePattern.Daily(), new RecurrenceEnd.Never()),
                    Start,
                    TestContext.CancellationToken
                )
            );
        Assert.AreEqual("recurrence interval must be positive", failure.detail);
        Assert.AreEqual(failure.detail, TaskNotesExceptionPolicy.UserFacingMessage(failure));
    }

    /// <summary>Rejects unknown native contract discriminants instead of substituting a different schedule.</summary>
    [TestMethod]
    public async Task UnknownPortableDiscriminantsFailLoudly()
    {
        _ = await Assert.ThrowsExactlyAsync<ArgumentOutOfRangeException>(() =>
            _editor.PatternAsync((RecurrenceFrequency)99, Start, TestContext.CancellationToken)
        );
        _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(() =>
            _editor.BuildAsync(
                new(1, new RecurrencePattern.Weekly([(DayOfWeek)99]), new RecurrenceEnd.Never()),
                Start,
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<InvalidOperationException>(() =>
            _editor.BuildAsync(
                new(
                    1,
                    new RecurrencePattern.MonthlyOrdinalWeekday(
                        (RecurrenceOrdinal)99,
                        DayOfWeek.Monday
                    ),
                    new RecurrenceEnd.Never()
                ),
                Start,
                TestContext.CancellationToken
            )
        );
    }

    private async Task AssertTuesdayStartAndWeeklyPatternAsync(RecurrenceProjection projection)
    {
        Assert.AreEqual("2026-10-06", projection.Start);
        _ = Assert.IsInstanceOfType<RecurrencePattern.Daily>(
            Assert.IsInstanceOfType<RecurrenceDraft>(projection.Draft).Pattern
        );
        RecurrencePattern.Weekly weekly = Assert.IsInstanceOfType<RecurrencePattern.Weekly>(
            await _editor.PatternAsync(
                RecurrenceFrequency.Weekly,
                projection.Start,
                TestContext.CancellationToken
            )
        );
        Assert.AreSequenceEqual([DayOfWeek.Tuesday], weekly.Weekdays);
    }

    private Task<RecurrenceProjection> ProjectAsync(string rule) =>
        _editor.ProjectAsync(rule, Start, null, Start, TestContext.CancellationToken);
}
