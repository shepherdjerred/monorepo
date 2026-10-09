using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests;

public sealed partial class FeedbackCaptureTests
{
    private static readonly string[] CoreChipKinds =
    [
        "due",
        "scheduled",
        "priority",
        "projects",
        "contexts",
        "tags",
        "recurrence",
    ];
    private static readonly string[] ExactContexts = ["Desk, upstairs"];
    private static readonly string[] ExactTags = ["client,review"];

    /// <summary>An erased unsubmitted capture relinquishes its old profile before fresh capture begins.</summary>
    [TestMethod]
    public async Task EmptyUnsubmittedCaptureStartsInTheNewProfile()
    {
        var store = new CaptureStore();
        var capture = new QuickAddViewModel(store) { Input = "Old draft" };
        Assert.AreEqual("p", capture.OwningProfile);
        capture.Input = "";
        Assert.IsFalse(capture.HasDraft);
        store.SelectedProfileId = "q";
        capture.SetContext(new(TaskListKind.Project, "New project"));
        capture.Input = "New draft";
        Assert.AreEqual("q", capture.OwningProfile);
        Assert.IsTrue(await capture.SaveAsync(false));
        Assert.AreEqual(1, store.SubmitCount);

        var tokenDraft = new QuickAddViewModel(store) { ContextEntry = "old" };
        tokenDraft.ContextEntry = "";
        store.SelectedProfileId = "r";
        tokenDraft.TagEntry = "new token";
        Assert.AreEqual("r", tokenDraft.OwningProfile);
        Assert.IsTrue(tokenDraft.HasDraft);
    }

    /// <summary>Native choices and chips expose exact configured tokens and the complete core preview.</summary>
    [TestMethod]
    public async Task CaptureControlsProjectConfiguredChoicesAndExactRemovableFields()
    {
        var store = new CaptureStore
        {
            State = TaskNotesState.Unconfigured with
            {
                PriorityChoices = [new("custom", "Important now")],
                Projects = ["ACME, Inc"],
                Contexts = ["Desk, upstairs"],
                Tags = ["client,review"],
            },
        };
        var capture = new QuickAddViewModel(store);
        Assert.IsEmpty(capture.CaptureChips);
        Assert.AreEqual("Enter a task to preview its parsed fields.", capture.PreviewDescription);
        Assert.AreEqual("Important now", capture.PriorityChoices.Single().Label);
        Assert.AreEqual("ACME, Inc", capture.ProjectChoices.Single());
        Assert.AreEqual("Desk, upstairs", capture.ContextChoices.Single());
        Assert.AreEqual("client,review", capture.TagChoices.Single());
        capture.Input = "Review";
        Assert.IsTrue(await capture.PreviewAsync());
        CollectionAssert.AreEqual(
            CoreChipKinds,
            capture.CaptureChips.Select(chip => chip.Kind).ToArray()
        );
        Assert.AreEqual(
            "Planned 2026-10-10",
            capture.CaptureChips.Single(chip => chip.Kind == "scheduled").Label
        );
        capture.Scheduled = new(2026, 10, 13, 0, 0, 0, TimeSpan.Zero);
        Assert.AreEqual(13, capture.Scheduled!.Value.Day);
        capture.Priority = capture.PriorityChoices.Single();
        capture.AddToken("contexts", "Desk, upstairs");
        capture.AddToken("contexts", "Desk, upstairs");
        capture.AddToken("tags", "client,review");
        capture.AddToken("tags", " ");
        capture.RemoveChip(capture.CaptureChips.Single(chip => chip.Kind == "contexts"));
        capture.RemoveChip(capture.CaptureChips.Single(chip => chip.Kind == "tags"));
        capture.RemoveChip(capture.CaptureChips.Single(chip => chip.Kind == "priority"));
        Assert.IsNull(capture.Priority);
        Assert.IsTrue(await capture.SaveAsync(false));
        Assert.AreEqual("2026-10-13", store.Submitted!.Scheduled!.Value);
        Assert.IsNull(store.Submitted.Priority!.Value);
        CollectionAssert.AreEqual(ExactContexts, store.Submitted.Contexts!.Value.ToArray());
        CollectionAssert.AreEqual(ExactTags, store.Submitted.Tags!.Value.ToArray());
    }

    /// <summary>Uncertain or applied-but-unobserved capture keeps its original durable identity and newer text.</summary>
    [TestMethod]
    public async Task SubmittedCaptureRecoveryCannotPrepareOrAdmitAnotherAction()
    {
        foreach (
            Exception error in new Exception[]
            {
                new IOException("uncertain"),
                new FacetSavedObservationException(),
            }
        )
        {
            var store = new CaptureStore { SubmitError = error };
            var capture = new QuickAddViewModel(store) { Input = "Original" };
            if (error is IOException)
                await Assert.ThrowsExactlyAsync<IOException>(() => capture.SaveAsync(false));
            else
                Assert.IsFalse(await capture.SaveAsync(false));
            Assert.AreEqual("durable-action", capture.RecoveryActionId);
            Assert.AreEqual(error is FacetSavedObservationException, capture.NeedsObservation);
            capture.Input = "Newer text";
            Assert.IsFalse(await capture.PreviewAsync());
            Assert.IsFalse(await capture.SaveAsync(false));
            Assert.IsFalse(capture.DiscardDraft());
            Assert.AreEqual(1, store.PrepareCount);
            Assert.AreEqual(1, store.SubmitCount);
            Assert.AreEqual("Newer text", capture.Input);
            StringAssert.Contains(
                capture.PreviewDescription,
                "Settings recovery",
                StringComparison.Ordinal
            );
            store.State = TaskNotesState.Unconfigured;
            Assert.IsTrue(capture.DiscardDraft());
            Assert.IsNull(capture.RecoveryActionId);
            Assert.IsFalse(capture.HasDraft);
        }
    }
}
