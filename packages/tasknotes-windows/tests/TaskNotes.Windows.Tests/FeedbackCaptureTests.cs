using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests;

/// <summary>Rich capture freezes fields, profile and original activation before preview awaits.</summary>
[TestClass]
public sealed partial class FeedbackCaptureTests
{
    private static readonly string[] ExactProject = ["ACME, Inc"];

    /// <summary>Unsubmitted token input is a retained draft and cannot be replaced by reopening capture.</summary>
    [TestMethod]
    public void PendingTokenTextRetainsDraftOwnership()
    {
        var store = new CaptureStore();
        var capture = new QuickAddViewModel(store) { ProjectEntry = "ACME, Inc" };
        Assert.IsTrue(capture.HasDraft);
        Assert.AreEqual("p", capture.OwningProfile);
        store.SelectedProfileId = "q";
        Assert.AreEqual("ACME, Inc", capture.ProjectEntry);
        Assert.AreEqual("p", capture.OwningProfile);
        Assert.IsTrue(capture.DiscardDraft());
        Assert.IsFalse(capture.HasDraft);
        Assert.AreEqual("", capture.ProjectEntry);
    }

    /// <summary>Newer dates/tokens survive an older receipt; immutable submitted arrays cannot change.</summary>
    [TestMethod]
    public async Task RichCaptureFreezesFieldsAndPreservesNewerDraft()
    {
        var waiting = new TaskCompletionSource<QuickAddPreview>(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        var store = new CaptureStore { PreviewWait = waiting.Task };
        var capture = new QuickAddViewModel(store)
        {
            Input = "Review",
            Body = "Submitted body",
            Due = new(2026, 10, 11, 0, 0, 0, TimeSpan.Zero),
        };
        capture.AddToken("projects", "ACME, Inc");
        var saving = capture.SaveAsync(true);
        capture.Body = "New body";
        capture.Due = new(2026, 10, 12, 0, 0, 0, TimeSpan.Zero);
        capture.AddToken("projects", "Later team");
        Assert.IsFalse(await capture.SaveAsync(true));
        waiting.SetResult(store.Preview);
        Assert.IsTrue(await saving);
        Assert.AreEqual("Submitted body", store.Submitted!.Body!.Value);
        Assert.AreEqual("2026-10-11", store.Submitted.Due!.Value);
        CollectionAssert.AreEqual(ExactProject, store.Submitted.Projects!.Value.ToArray());
        Assert.AreEqual("New body", capture.Body);
        Assert.HasCount(2, capture.Projects);
        Assert.IsTrue(capture.HasDraft);
        Assert.IsFalse(capture.CanDismissAfterSave);
    }

    /// <summary>Chip clears remain present canonical null/empty values, including planned, recurrence and body.</summary>
    [TestMethod]
    public async Task ExplicitParsedFieldClearsReachTheSubmittedOptions()
    {
        var store = new CaptureStore();
        var capture = new QuickAddViewModel(store) { Input = "Review" };
        Assert.IsTrue(await capture.PreviewAsync());
        foreach (
            var chip in new[]
            {
                new CaptureChip("due", "2026-10-11", "due"),
                new CaptureChip("scheduled", "2026-10-11", "planned"),
                new CaptureChip("recurrence", "FREQ=DAILY", "daily"),
                new CaptureChip("projects", "Parsed project", "project"),
                new CaptureChip("tags", "parsed", "tag"),
            }
        )
            capture.RemoveChip(chip);
        capture.ClearBody();
        Assert.IsTrue(await capture.SaveAsync(false));
        Assert.IsNotNull(store.Submitted!.Due);
        Assert.IsNull(store.Submitted.Due.Value);
        Assert.IsNotNull(store.Submitted.Scheduled);
        Assert.IsNull(store.Submitted.Scheduled.Value);
        Assert.IsNotNull(store.Submitted.Recurrence);
        Assert.IsNull(store.Submitted.Recurrence.Value);
        Assert.IsEmpty(store.Submitted.Projects!.Value);
        Assert.IsEmpty(store.Submitted.Tags!.Value);
        Assert.AreEqual("", store.Submitted.Body!.Value);
    }

    /// <summary>A profile switch before preview finishes cannot redirect capture into another vault.</summary>
    [TestMethod]
    public async Task PreviewProfileSwitchKeepsOriginalDraftEditableWithoutAdmission()
    {
        var waiting = new TaskCompletionSource<QuickAddPreview>(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        var store = new CaptureStore { PreviewWait = waiting.Task };
        var capture = new QuickAddViewModel(store) { Input = "Original vault" };
        var saving = capture.SaveAsync(false);
        store.SelectedProfileId = "q";
        waiting.SetResult(store.Preview);
        await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            saving.WaitAsync(CancellationToken.None)
        );
        Assert.IsNull(capture.RecoveryActionId);
        Assert.AreEqual("p", capture.OwningProfile);
        Assert.AreEqual("Original vault", capture.Input);
    }

    /// <summary>Focus away and back during parsing never creates a fresh lease for an already admitted Save.</summary>
    [TestMethod]
    public async Task CaptureKeepsOriginalActivationLeaseAcrossPreview()
    {
        var waiting = new TaskCompletionSource<QuickAddPreview>(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        var store = new CaptureStore { PreviewWait = waiting.Task };
        store.Scene.SetForeground(true);
        var capture = new QuickAddViewModel(store) { Input = "Original scene" };
        var saving = capture.SaveAsync(false);
        store.Scene.SetForeground(false);
        store.Scene.SetForeground(true);
        waiting.SetResult(store.Preview);
        Assert.IsTrue(await saving);
        Assert.IsFalse(store.Submitted!.FeedbackLease!.IsCurrent);
        Assert.IsTrue(capture.CanDismissAfterSave);
    }

    private sealed class CaptureStore : TestTaskNotesStore, IFacetDetailedCaptureStore
    {
        internal CaptureStore() =>
            Preview = new(
                "Review",
                "2026-10-11",
                "normal",
                ["Parsed project"],
                ["desk"],
                ["parsed"],
                "FREQ=DAILY"
            )
            {
                Scheduled = "2026-10-10",
            };

        public async Task<FacetPreparedCapture> PrepareCaptureAsync(
            string input,
            TaskListQuery context,
            string? profile,
            FacetCaptureOptions options,
            CancellationToken cancellationToken = default
        )
        {
            PrepareCount++;
            var frozen = options.Freeze();
            var preview = await PreviewCaptureAsync(
                input,
                context,
                profile,
                frozen,
                cancellationToken
            );
            return new(
                profile!,
                "test",
                0,
                preview,
                System.Text.Json.JsonSerializer.SerializeToElement(new { kind = "create" }),
                "test",
                frozen
            );
        }

        public Task SubmitPreparedCaptureAsync(
            FacetPreparedCapture capture,
            Action<string> admitted,
            CancellationToken cancellationToken = default
        ) =>
            AddDetailedCaptureAsync(
                "",
                TaskListQuery.Today,
                capture.Profile,
                capture.Options,
                admitted,
                cancellationToken
            );

        public string? SelectedProfileId { get; set; } = "p";
        internal FacetFeedbackScene Scene { get; } = new();
        internal Task<QuickAddPreview>? PreviewWait { get; init; }
        internal FacetCaptureOptions? Submitted { get; private set; }
        internal int PrepareCount { get; private set; }
        internal int SubmitCount { get; private set; }
        internal Exception? SubmitError { get; init; }

        public FacetFeedbackLease? CaptureFeedbackLease() => Scene.Capture();

        public Task<QuickAddPreview> PreviewCaptureAsync(
            string input,
            TaskListQuery context,
            string? profile,
            FacetCaptureOptions options,
            CancellationToken cancellationToken = default
        ) => PreviewWait ?? Task.FromResult(Preview);

        public Task AddCaptureAsync(
            string input,
            TaskListQuery context,
            string? profile,
            Action<string> admitted,
            CancellationToken cancellationToken = default
        ) => AddDetailedCaptureAsync(input, context, profile, new(), admitted, cancellationToken);

        public Task AddDetailedCaptureAsync(
            string input,
            TaskListQuery context,
            string? profile,
            FacetCaptureOptions options,
            Action<string> admitted,
            CancellationToken cancellationToken = default
        )
        {
            if (profile != SelectedProfileId)
                throw new ArgumentException("Capture belongs to its original vault.");
            Submitted = options;
            SubmitCount++;
            admitted("durable-action");
            if (SubmitError is not null)
            {
                State = State with
                {
                    FacetPendingActions = [new("durable-action", profile!, "Original", "create")],
                };
                throw SubmitError;
            }
            return Task.CompletedTask;
        }
    }
}
