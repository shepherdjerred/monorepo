using TaskNotes.Protocol;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Verifies pure-C# natural-language Quick Add token parsing, defaults, and option overrides.</summary>
[TestClass]
public sealed class QuickCaptureParserTests
{
    private static readonly DateOnly AnchorThursday = new(2026, 10, 8);

    /// <summary>Parses relative dates, weekdays, ISO dates, priorities, projects, labels, and quoted phrases.</summary>
    [TestMethod]
    public void ParsesDatesProjectsLabelsPrioritiesAndQuotes()
    {
        ParsedQuickCapture parsed = QuickCaptureParser.Parse(
            "Ship #\"Windows Client\" @\"deep work\" @urgent tomorrow p1 every weekday",
            AnchorThursday,
            resolveProjectId: name => $"proj:{name}",
            resolveLabelId: name => $"lbl:{name}"
        );

        Assert.AreEqual("Ship", parsed.Preview.Title);
        Assert.AreEqual("2026-10-09", parsed.Preview.Due);
        Assert.AreEqual("p1", parsed.Preview.Priority);
        Assert.AreSequenceEqual(["Windows Client"], parsed.Preview.Projects);
        Assert.AreSequenceEqual(["deep work", "urgent"], parsed.Preview.Tags);
        Assert.IsEmpty(parsed.Preview.Contexts);
        Assert.AreEqual("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", parsed.Preview.Recurrence);
        Assert.AreEqual("proj:Windows Client", parsed.CommandArgs.ProjectId);
        Assert.AreEqual(Priority.P1, parsed.CommandArgs.Priority);
        Assert.AreSequenceEqual(["lbl:deep work", "lbl:urgent"], parsed.CommandArgs.LabelIds!);
    }

    /// <summary>Covers today, next week, weekday tokens, ISO dates, bang priorities, and multi-token recurrence phrases.</summary>
    [TestMethod]
    public void ParsesEveryDatePriorityAndRecurrenceVariant()
    {
        Assert.AreEqual(
            "2026-10-08",
            QuickCaptureParser.Parse("Call mom today", AnchorThursday).Preview.Due
        );
        Assert.AreEqual(
            "2026-10-15",
            QuickCaptureParser.Parse("Review next week", AnchorThursday).Preview.Due
        );
        Assert.AreEqual(
            "2026-10-12",
            QuickCaptureParser.Parse("Standup next monday", AnchorThursday).Preview.Due
        );
        Assert.AreEqual(
            "2026-10-09",
            QuickCaptureParser.Parse("Demo fri !2", AnchorThursday).Preview.Due
        );
        Assert.AreEqual(
            "p2",
            QuickCaptureParser.Parse("Demo fri !2", AnchorThursday).Preview.Priority
        );
        Assert.AreEqual(
            "p3",
            QuickCaptureParser.Parse("Triage p3", AnchorThursday).Preview.Priority
        );
        Assert.AreEqual(
            "2026-12-25",
            QuickCaptureParser.Parse("Gifts 2026-12-25 p4", AnchorThursday).Preview.Due
        );

        Assert.AreEqual(
            "FREQ=DAILY",
            QuickCaptureParser.Parse("Vitamins daily", AnchorThursday).Preview.Recurrence
        );
        Assert.AreEqual(
            "FREQ=WEEKLY",
            QuickCaptureParser.Parse("Sync weekly", AnchorThursday).Preview.Recurrence
        );
        Assert.AreEqual(
            "FREQ=MONTHLY",
            QuickCaptureParser.Parse("Rent monthly", AnchorThursday).Preview.Recurrence
        );
        Assert.AreEqual(
            "FREQ=YEARLY",
            QuickCaptureParser.Parse("Taxes yearly", AnchorThursday).Preview.Recurrence
        );
        Assert.AreEqual(
            "FREQ=DAILY;INTERVAL=3",
            QuickCaptureParser.Parse("Water plants every 3 days", AnchorThursday).Preview.Recurrence
        );
        Assert.AreEqual(
            "FREQ=WEEKLY;INTERVAL=2",
            QuickCaptureParser.Parse("Retro every 2 weeks", AnchorThursday).Preview.Recurrence
        );
        Assert.AreEqual(
            "FREQ=MONTHLY;INTERVAL=6",
            QuickCaptureParser.Parse("Dentist every 6 months", AnchorThursday).Preview.Recurrence
        );
        Assert.AreEqual(
            "FREQ=YEARLY;INTERVAL=2",
            QuickCaptureParser.Parse("Passport every 2 years", AnchorThursday).Preview.Recurrence
        );
        Assert.AreEqual(
            "FREQ=WEEKLY;BYDAY=FR",
            QuickCaptureParser.Parse("Deploy every friday", AnchorThursday).Preview.Recurrence
        );
        Assert.AreEqual(
            "FREQ=DAILY",
            QuickCaptureParser.Parse("Backup every day", AnchorThursday).Preview.Recurrence
        );
    }

    /// <summary>Applies Today/Project/Tag/Context defaults when absent and honors explicit FacetCaptureOptions clears.</summary>
    [TestMethod]
    public void AppliesContextualDefaultsAndExplicitOptionOverrides()
    {
        ParsedQuickCapture inToday = QuickCaptureParser.Parse(
            "Write summary",
            AnchorThursday,
            TaskListQuery.Today
        );
        Assert.AreEqual("2026-10-08", inToday.Preview.Due);

        ParsedQuickCapture inProject = QuickCaptureParser.Parse(
            "Fix bug",
            AnchorThursday,
            new TaskListQuery(TaskListKind.Project, "Backend")
        );
        Assert.AreSequenceEqual(["Backend"], inProject.Preview.Projects);

        ParsedQuickCapture inTag = QuickCaptureParser.Parse(
            "Read RFC",
            AnchorThursday,
            new TaskListQuery(TaskListKind.Tag, "architecture")
        );
        Assert.AreSequenceEqual(["architecture"], inTag.Preview.Tags);

        ParsedQuickCapture inContext = QuickCaptureParser.Parse(
            "Reply email",
            AnchorThursday,
            new TaskListQuery(TaskListKind.Context, "office")
        );
        Assert.AreSequenceEqual(["office"], inContext.Preview.Contexts);

        FacetCaptureOptions cleared = new(
            Body: new FacetCaptureField<string>("Detailed notes"),
            Due: new FacetCaptureField<string?>(null),
            Priority: new FacetCaptureField<string?>("p1"),
            Projects: new FacetCaptureField<IReadOnlyList<string>>([]),
            Contexts: new FacetCaptureField<IReadOnlyList<string>>(["home"]),
            Tags: new FacetCaptureField<IReadOnlyList<string>>([]),
            Scheduled: new FacetCaptureField<string?>("2026-10-20"),
            Recurrence: new FacetCaptureField<string?>(null)
        );
        ParsedQuickCapture overridden = QuickCaptureParser.Parse(
            "Review #Work @errands tomorrow daily",
            AnchorThursday,
            null,
            cleared
        );
        Assert.IsNull(overridden.Preview.Due);
        Assert.AreEqual("2026-10-20", overridden.Preview.Scheduled);
        Assert.AreEqual("2026-10-20", overridden.CommandArgs.DueDate);
        Assert.AreEqual("p1", overridden.Preview.Priority);
        Assert.IsEmpty(overridden.Preview.Projects);
        Assert.IsEmpty(overridden.Preview.Tags);
        Assert.AreSequenceEqual(["home"], overridden.Preview.Contexts);
        Assert.IsNull(overridden.Preview.Recurrence);
        Assert.AreEqual("Detailed notes", overridden.Description);

        Assert.AreEqual(Priority.P1, QuickCaptureParser.ParseProtocolPriority("urgent"));
        Assert.AreEqual(Priority.P2, QuickCaptureParser.ParseProtocolPriority("high"));
        Assert.AreEqual(Priority.P3, QuickCaptureParser.ParseProtocolPriority("medium"));
        Assert.AreEqual(Priority.P4, QuickCaptureParser.ParseProtocolPriority("normal"));
        _ = Assert.ThrowsExactly<FacetValidationException>(() =>
            QuickCaptureParser.ParseProtocolPriority("bogus")
        );
    }
}
