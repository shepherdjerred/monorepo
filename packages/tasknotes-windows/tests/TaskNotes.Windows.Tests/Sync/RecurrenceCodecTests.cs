using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Exercises the pure-C# RFC 5545 recurrence codec, projections, and occurrence math.</summary>
[TestClass]
public sealed class RecurrenceCodecTests
{
    private const string Start = "2026-10-05";
    private readonly RecurrenceCodec _editor = RecurrenceCodec.Shared;

    /// <summary>Gets or sets the MSTest execution context.</summary>
    public required TestContext TestContext { get; set; }

    /// <summary>Retains every weekly selector and the count while changing only the interval.</summary>
    [TestMethod]
    public async Task WeeklyIntervalEditPreservesWeekdaysAndCount()
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

    /// <summary>Round-trips all common pattern variants and all ending variants.</summary>
    [TestMethod]
    public async Task EveryCommonPatternAndEndingRoundTrips()
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

    /// <summary>Derives pattern defaults from the resolved start anchor.</summary>
    [TestMethod]
    public async Task PatternDefaultsComeFromResolvedAnchor()
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
    [DataRow("FREQ=MONTHLY;BYDAY=6MO")]
    [DataRow("FREQ=MONTHLY;BYMONTHDAY=-1")]
    [DataRow("RRULE:FREQ=DAILY;UNTIL=20261231T235959Z")]
    public async Task DeclinedRulesAndAnchorFallbacksFollowStrictContract(string rule)
    {
        if (rule.StartsWith("RRULE:", StringComparison.Ordinal))
        {
            RecurrenceDraft? projected = (await ProjectAsync(rule)).Draft;
            Assert.IsNotNull(projected);
            Assert.AreEqual(new RecurrenceEnd.OnDate("2026-12-31"), projected.Ending);
            return;
        }
        Assert.IsNull((await ProjectAsync(rule)).Draft);
    }

    /// <summary>Validates anchor precedence (scheduled over created over today) and rejects invalid anchors.</summary>
    [TestMethod]
    public async Task AnchorPrecedenceAndInvalidAnchorRejection()
    {
        RecurrenceProjection unresolvedExisting = await _editor.ProjectAsync(
            "FREQ=WEEKLY",
            null,
            null,
            Start,
            TestContext.CancellationToken
        );
        Assert.AreEqual(Start, unresolvedExisting.Start);
        Assert.IsNull(unresolvedExisting.Draft);

        RecurrenceProjection empty = await _editor.ProjectAsync(
            "",
            null,
            null,
            Start,
            TestContext.CancellationToken
        );
        Assert.IsInstanceOfType<RecurrencePattern.Daily>(
            Assert.IsInstanceOfType<RecurrenceDraft>(empty.Draft).Pattern
        );

        RecurrenceProjection fromScheduled = await _editor.ProjectAsync(
            "FREQ=MONTHLY",
            "2026-10-07",
            "2026-10-06T12:00:00Z",
            Start,
            TestContext.CancellationToken
        );
        Assert.AreEqual("2026-10-07", fromScheduled.Start);
        Assert.AreEqual(
            new RecurrencePattern.MonthlyDayOfMonth(7),
            Assert.IsInstanceOfType<RecurrenceDraft>(fromScheduled.Draft).Pattern
        );

        RecurrenceProjection fromCreated = await _editor.ProjectAsync(
            "FREQ=YEARLY",
            null,
            "2026-10-06T12:00:00Z",
            Start,
            TestContext.CancellationToken
        );
        Assert.AreEqual("2026-10-06", fromCreated.Start);
        Assert.AreEqual(
            new RecurrencePattern.YearlyMonthDay(10, 6),
            Assert.IsInstanceOfType<RecurrenceDraft>(fromCreated.Draft).Pattern
        );

        Assert.IsNull(
            (
                await _editor.ProjectAsync(
                    "FREQ=DAILY",
                    "bad-date",
                    "2026-10-06",
                    Start,
                    TestContext.CancellationToken
                )
            ).Draft
        );
        Assert.IsNull(
            (
                await _editor.ProjectAsync(
                    "",
                    null,
                    "bad-date",
                    Start,
                    TestContext.CancellationToken
                )
            ).Draft
        );
    }

    /// <summary>Retains every weekday and ordinal discriminant and rejects invalid drafts/discriminants.</summary>
    [TestMethod]
    public async Task OrdinalsValidationErrorsAndUnknownDiscriminants()
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

        FacetValidationException zeroInterval =
            await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
                _editor.BuildAsync(
                    new(0, new RecurrencePattern.Daily(), new RecurrenceEnd.Never()),
                    Start,
                    TestContext.CancellationToken
                )
            );
        Assert.AreEqual("recurrence interval must be positive", zeroInterval.Message);

        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            _editor.BuildAsync(
                new(1, new RecurrencePattern.Weekly([]), new RecurrenceEnd.Never()),
                Start,
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            _editor.BuildAsync(
                new(1, new RecurrencePattern.MonthlyDayOfMonth(0), new RecurrenceEnd.Never()),
                Start,
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            _editor.BuildAsync(
                new(1, new RecurrencePattern.YearlyMonthDay(2, 30), new RecurrenceEnd.Never()),
                Start,
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            _editor.BuildAsync(
                new(1, new RecurrencePattern.Daily(), new RecurrenceEnd.AfterOccurrences(0)),
                Start,
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            _editor.BuildAsync(
                new(1, new RecurrencePattern.Daily(), new RecurrenceEnd.OnDate("bad")),
                Start,
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            _editor.ProjectAsync(
                "FREQ=DAILY",
                null,
                null,
                "bad-today",
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            _editor.PatternAsync(
                RecurrenceFrequency.Daily,
                "bad-start",
                TestContext.CancellationToken
            )
        );
        _ = await Assert.ThrowsExactlyAsync<FacetValidationException>(() =>
            _editor.BuildAsync(
                new(1, new RecurrencePattern.Daily(), new RecurrenceEnd.Never()),
                "bad-start",
                TestContext.CancellationToken
            )
        );
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

    /// <summary>Calculates next occurrences across daily, weekly, monthly, yearly, COUNT, UNTIL, and DTSTART rules.</summary>
    [TestMethod]
    public void ComputeNextOccurrenceAndOccursOnCoverAllCalendarRules()
    {
        DateOnly today = new(2026, 10, 8);

        NextOccurrenceResult daily = RecurrenceCodec.ComputeNextOccurrence(
            "FREQ=DAILY;INTERVAL=2",
            "2026-10-08",
            today
        );
        Assert.IsFalse(daily.ShouldComplete);
        Assert.AreEqual("2026-10-10", daily.NextDate);

        NextOccurrenceResult weekly = RecurrenceCodec.ComputeNextOccurrence(
            "FREQ=WEEKLY;BYDAY=MO,FR",
            "2026-10-08",
            today
        );
        Assert.AreEqual("2026-10-09", weekly.NextDate);

        NextOccurrenceResult weeklyJump = RecurrenceCodec.ComputeNextOccurrence(
            "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
            "2026-10-05",
            today
        );
        Assert.AreEqual("2026-10-19", weeklyJump.NextDate);

        NextOccurrenceResult monthlyClamp = RecurrenceCodec.ComputeNextOccurrence(
            "FREQ=MONTHLY;BYMONTHDAY=31",
            "2026-01-31",
            today
        );
        Assert.AreEqual("2026-02-28", monthlyClamp.NextDate);

        NextOccurrenceResult monthlyLastDay = RecurrenceCodec.ComputeNextOccurrence(
            "FREQ=MONTHLY;BYMONTHDAY=-1",
            "2024-01-31",
            today
        );
        Assert.AreEqual("2024-02-29", monthlyLastDay.NextDate);

        NextOccurrenceResult monthlyOrdinal = RecurrenceCodec.ComputeNextOccurrence(
            "FREQ=MONTHLY;BYDAY=-1FR",
            "2026-10-30",
            today
        );
        Assert.AreEqual("2026-11-27", monthlyOrdinal.NextDate);

        NextOccurrenceResult yearlyLeap = RecurrenceCodec.ComputeNextOccurrence(
            "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29",
            "2024-02-29",
            today
        );
        Assert.AreEqual("2025-02-28", yearlyLeap.NextDate);

        NextOccurrenceResult countDecrement = RecurrenceCodec.ComputeNextOccurrence(
            "DTSTART:20261001\nRRULE:FREQ=DAILY;COUNT=3",
            null,
            today
        );
        Assert.IsFalse(countDecrement.ShouldComplete);
        Assert.AreEqual("2026-10-02", countDecrement.NextDate);
        StringAssert.Contains(countDecrement.UpdatedRule!, "COUNT=2", StringComparison.Ordinal);

        NextOccurrenceResult countExhausted = RecurrenceCodec.ComputeNextOccurrence(
            "FREQ=DAILY;COUNT=1",
            "2026-10-08",
            today
        );
        Assert.IsTrue(countExhausted.ShouldComplete);
        Assert.IsNull(countExhausted.NextDate);

        NextOccurrenceResult untilReached = RecurrenceCodec.ComputeNextOccurrence(
            "FREQ=DAILY;UNTIL=20261008",
            "2026-10-08",
            today
        );
        Assert.IsTrue(untilReached.ShouldComplete);

        Assert.IsTrue(
            RecurrenceCodec.OccursOn(
                "FREQ=DAILY;INTERVAL=2",
                "2026-10-08",
                new DateOnly(2026, 10, 10)
            )
        );
        Assert.IsFalse(
            RecurrenceCodec.OccursOn(
                "FREQ=DAILY;INTERVAL=2",
                "2026-10-08",
                new DateOnly(2026, 10, 9)
            )
        );
        Assert.IsTrue(
            RecurrenceCodec.OccursOn(
                "FREQ=WEEKLY;BYDAY=MO,TH",
                "2026-10-05",
                new DateOnly(2026, 10, 8)
            )
        );
        Assert.IsTrue(
            RecurrenceCodec.OccursOn(
                "FREQ=MONTHLY;BYMONTHDAY=31",
                "2026-01-31",
                new DateOnly(2026, 2, 28)
            )
        );
        Assert.IsTrue(
            RecurrenceCodec.OccursOn("FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=8", "2025-10-08", today)
        );
        Assert.IsFalse(RecurrenceCodec.OccursOn("", "2026-10-08", today));
        Assert.IsFalse(RecurrenceCodec.OccursOn("FREQ=DAILY", "2026-10-10", today));
        Assert.IsFalse(RecurrenceCodec.OccursOn("FREQ=DAILY;UNTIL=20261007", "2026-10-01", today));
        Assert.IsFalse(RecurrenceCodec.OccursOn("NOT_A_RULE", "2026-10-01", today));
        Assert.IsTrue(
            RecurrenceCodec.OccursOn(
                "FREQ=MONTHLY;BYDAY=2TH",
                "2026-09-10",
                new DateOnly(2026, 10, 8)
            )
        );
        Assert.IsFalse(
            RecurrenceCodec.OccursOn("FREQ=WEEKLY;INTERVAL=2;BYDAY=TH", "2026-10-01", today)
        );
        Assert.IsTrue(
            RecurrenceCodec.ComputeNextOccurrence("INVALID", "2026-10-08", today).ShouldComplete
        );
        Assert.AreEqual(
            "2026-11-02",
            RecurrenceCodec
                .ComputeNextOccurrence("FREQ=MONTHLY;BYDAY=1MO", "2026-10-05", today)
                .NextDate
        );
        Assert.AreEqual(
            "2026-10-08",
            RecurrenceCodec
                .ComputeNextOccurrence("FREQ=WEEKLY;BYDAY=MO,TH", "2026-10-05", today)
                .NextDate
        );
    }

    /// <summary>Parses semicolon-delimited DTSTART and DTSTART;VALUE=DATE rules across projection, anchor extraction, and occurrence math.</summary>
    [TestMethod]
    public async Task SemicolonDelimitedDtStartRulesProjectAndAdvanceCleanly()
    {
        const string monthlyRule = "DTSTART:20260901;FREQ=MONTHLY;BYMONTHDAY=1";
        const string weeklyValueDateRule = "DTSTART;VALUE=DATE:20260901;FREQ=WEEKLY;BYDAY=MO";

        RecurrenceProjection monthlyProjection = await _editor.ProjectAsync(
            monthlyRule,
            null,
            null,
            Start,
            TestContext.CancellationToken
        );
        Assert.AreEqual("2026-09-01", monthlyProjection.Start);
        RecurrenceDraft monthlyDraft = Assert.IsInstanceOfType<RecurrenceDraft>(
            monthlyProjection.Draft
        );
        Assert.AreEqual(new RecurrencePattern.MonthlyDayOfMonth(1), monthlyDraft.Pattern);
        Assert.AreEqual(new RecurrenceEnd.Never(), monthlyDraft.Ending);

        NextOccurrenceResult monthlyFromDtStart = RecurrenceCodec.ComputeNextOccurrence(
            monthlyRule,
            null,
            new DateOnly(2026, 10, 8)
        );
        Assert.IsFalse(monthlyFromDtStart.ShouldComplete);
        Assert.AreEqual("2026-10-01", monthlyFromDtStart.NextDate);
        Assert.IsTrue(RecurrenceCodec.OccursOn(monthlyRule, null, new DateOnly(2026, 10, 1)));
        Assert.IsFalse(RecurrenceCodec.OccursOn(monthlyRule, null, new DateOnly(2026, 8, 1)));

        RecurrenceProjection weeklyProjection = await _editor.ProjectAsync(
            weeklyValueDateRule,
            null,
            null,
            Start,
            TestContext.CancellationToken
        );
        Assert.AreEqual("2026-09-01", weeklyProjection.Start);
        RecurrenceDraft weeklyDraft = Assert.IsInstanceOfType<RecurrenceDraft>(
            weeklyProjection.Draft
        );
        RecurrencePattern.Weekly weeklyPattern = Assert.IsInstanceOfType<RecurrencePattern.Weekly>(
            weeklyDraft.Pattern
        );
        Assert.AreSequenceEqual([DayOfWeek.Monday], weeklyPattern.Weekdays);

        NextOccurrenceResult weeklyFromDtStart = RecurrenceCodec.ComputeNextOccurrence(
            weeklyValueDateRule,
            null,
            new DateOnly(2026, 9, 1)
        );
        Assert.IsFalse(weeklyFromDtStart.ShouldComplete);
        Assert.AreEqual("2026-09-07", weeklyFromDtStart.NextDate);
        Assert.IsTrue(
            RecurrenceCodec.OccursOn(weeklyValueDateRule, null, new DateOnly(2026, 9, 7))
        );
        Assert.IsFalse(
            RecurrenceCodec.OccursOn(weeklyValueDateRule, null, new DateOnly(2026, 8, 31))
        );
    }

    private Task<RecurrenceProjection> ProjectAsync(string rule) =>
        _editor.ProjectAsync(rule, Start, null, Start, TestContext.CancellationToken);
}
