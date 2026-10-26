using System.Text.Json;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests;

/// <summary>Dependency drafts retain opaque records and obey asynchronous owner fences.</summary>
[TestClass]
public sealed class DependencyEditorTests
{
    /// <summary>Body-only saves omit dependencies; unsupported entries remain visible and read-only.</summary>
    [TestMethod]
    public async Task UntouchedDependencyObjectsAndOpaqueEntriesAreNotResubmitted()
    {
        TestTaskNotesStore store = new();
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(
            CreateTask(
                "one",
                """{"blockedBy":[{"uid":"[[a,b|Alias]]","reltype":"STARTTOSTART","gap":"-PT15M","vendor":{"exact":9007199254740993}},"legacy opaque"]}"""
            )
        );
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        Assert.AreEqual("[[a,b|Alias]]", editor.Dependencies[0].Uid);
        Assert.AreEqual(
            "Start to start",
            editor
                .Dependencies[0]
                .RelationChoices.Single(choice => choice.Value == "STARTTOSTART")
                .Label
        );
        Assert.IsFalse(editor.Dependencies[1].IsEditable);
        Assert.AreEqual("\"legacy opaque\"", editor.Dependencies[1].ExistingValueText);
        StringAssert.Contains(
            editor.Dependencies[1].ExistingValueWarning,
            "read-only",
            StringComparison.Ordinal
        );
        Assert.IsFalse(editor.IsDirty);
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        Assert.IsFalse(editor.IsDirty);
        editor.Details = "Body only";
        Assert.IsTrue(await editor.SaveAsync(TestContext.CancellationToken));
        Assert.IsFalse(store.LastEdit!.ChangedProperties!.ContainsKey("blockedBy"));
        editor.RemoveDependency(editor.Dependencies[1]);
        Assert.HasCount(1, editor.Dependencies);
        Assert.IsTrue(await editor.CommitFieldAsync("blockedBy", TestContext.CancellationToken));
        Assert.AreEqual(1, store.LastEdit!.ChangedProperties!["blockedBy"].GetArrayLength());
    }

    /// <summary>Malformed whole values are visible, preserved on ordinary edits and replaced only by an explicit draft action.</summary>
    [TestMethod]
    public async Task UnsupportedWholeListRequiresAnExplicitReplacement()
    {
        TestTaskNotesStore store = new();
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(CreateTask("one", """{"blockedBy":{"legacy":"keep"}}"""));
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        Assert.IsTrue(editor.CanReplaceDependencyList);
        Assert.IsFalse(editor.CanAddDependency);
        Assert.AreEqual("""{"legacy":"keep"}""", editor.DependencyListValue);
        Assert.IsFalse(editor.IsDirty);
        editor.Details = "Unrelated body";
        Assert.IsTrue(await editor.CommitFieldAsync("body", TestContext.CancellationToken));
        Assert.IsFalse(store.LastEdit!.ChangedProperties!.ContainsKey("blockedBy"));
        editor.ReplaceDependencyList();
        editor.AddDependency();
        editor.Dependencies.Single().Uid = "new reference";
        editor.Dependencies.Single().RelationType = "STARTTOSTART";
        Assert.IsTrue(await editor.CommitFieldAsync("blockedBy", TestContext.CancellationToken));
        Assert.AreEqual(
            "new reference",
            store.LastEdit!.ChangedProperties!["blockedBy"][0].GetProperty("uid").GetString()
        );
    }

    /// <summary>Incomplete new dependency rows do not block an unrelated field commit or get discarded by its observation.</summary>
    [TestMethod]
    public async Task UnsentDependencyDraftSurvivesAnUnrelatedFieldSave()
    {
        TestTaskNotesStore store = new();
        var original = CreateTask("one", "{}");
        store.Publish(store.State with { AllTasks = [original] });
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(original);
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        editor.AddDependency();
        editor.Dependencies[0].Uid = "[[unsent, reference]]";
        editor.Details = "Body changed";
        Assert.IsTrue(await editor.CommitFieldAsync("body", TestContext.CancellationToken));
        Assert.IsFalse(store.LastEdit!.ChangedProperties!.ContainsKey("blockedBy"));
        Assert.HasCount(1, editor.Dependencies);
        Assert.AreEqual("[[unsent, reference]]", editor.Dependencies[0].Uid);
        Assert.AreEqual("", editor.Dependencies[0].RelationType);
        Assert.IsTrue(editor.IsDirty);
        _ = await Assert.ThrowsExactlyAsync<ArgumentException>(() =>
            editor.SaveAsync(TestContext.CancellationToken)
        );
    }

    /// <summary>Late metadata cannot apply to a different task; configured defaults come only from the winning core reading.</summary>
    [TestMethod]
    public async Task MetadataCompletionIsFencedByTheLoadedOwner()
    {
        TaskCompletionSource<DependencyEditorMetadata> old = new(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        TestTaskNotesStore store = new()
        {
            DependencyMetadata = async (_, token) => await old.Task.WaitAsync(token),
        };
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(CreateTask("one", "{}"));
        Task loading = editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        editor.Load(CreateTask("two", "{}"));
        old.SetResult(new DependencyEditorMetadata(["STARTTOSTART"], "STARTTOSTART"));
        await loading;
        Assert.IsFalse(editor.CanAddDependency);
        store.DependencyMetadata = (_, _) =>
            Task.FromResult(new DependencyEditorMetadata(["FINISHTOFINISH"], "FINISHTOFINISH"));
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        editor.AddDependency();
        Assert.AreEqual("FINISHTOFINISH", editor.Dependencies.Single().RelationType);
        Assert.AreEqual("two", editor.TaskId);
    }

    /// <summary>A metadata failure reports its error without clearing an existing dependency draft.</summary>
    [TestMethod]
    public async Task MetadataFailureRetainsTheDraftForRetry()
    {
        TestTaskNotesStore store = new();
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(CreateTask("one", "{}"));
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        editor.AddDependency();
        editor.Dependencies.Single().Uid = "retained";
        store.DependencyMetadata = (_, _) => throw new IOException("Metadata provider unavailable");
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        Assert.AreEqual("retained", editor.Dependencies.Single().Uid);
        Assert.IsNotNull(editor.DependencyMetadataError);
        Assert.IsFalse(editor.CanAddDependency);
        Assert.IsTrue(editor.IsDirty);
    }

    /// <summary>Changed selections need no physical gesture, while metadata notifications and stale owners cannot change a draft.</summary>
    [TestMethod]
    public async Task MetadataRefreshCannotActAsARelationshipInputGesture()
    {
        TestTaskNotesStore store = new();
        using var editor = new TaskEditorViewModel(store, new Dispatcher());
        editor.Load(
            CreateTask(
                "one",
                """{"blockedBy":[{"uid":"original","reltype":"FINISHTOSTART","vendor":true}]}"""
            )
        );
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        var row = editor.Dependencies.Single();
        var choices = row.RelationChoices;
        Assert.IsNull(editor.CaptureDependencyRelationChoice(row, row.RelationType));
        Assert.IsNull(editor.CaptureDependencyRelationChoice(row, null));
        Assert.IsNull(editor.CaptureDependencyRelationChoice(row, "unknown"));
        var oldChoice = editor.CaptureDependencyRelationChoice(row, "STARTTOSTART");
        Assert.IsNotNull(oldChoice);
        TaskCompletionSource<DependencyEditorMetadata> pending = new(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        store.DependencyMetadata = async (_, token) => await pending.Task.WaitAsync(token);
        Task refreshing = editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        Assert.AreSame(choices, row.RelationChoices);
        Assert.IsFalse(row.IsEditable);
        Assert.IsNull(editor.CaptureDependencyRelationChoice(row, "STARTTOSTART"));
        Assert.IsFalse(editor.ApplyDependencyRelationChoice(oldChoice, row, "STARTTOSTART"));
        Assert.AreEqual("FINISHTOSTART", row.RelationType);
        Assert.IsFalse(editor.IsDirty);
        pending.SetResult(
            new DependencyEditorMetadata(choices.Select(choice => choice.Value).ToArray(), null)
        );
        await refreshing;
        Assert.AreSame(choices, row.RelationChoices);
        Assert.AreEqual("FINISHTOSTART", row.RelationType);
        Assert.IsFalse(editor.IsDirty);
        Assert.IsNull(editor.CaptureDependencyRelationChoice(row, row.RelationType));
        var selection = editor.CaptureDependencyRelationChoice(row, "STARTTOSTART");
        Assert.IsNotNull(selection);
        Assert.IsFalse(editor.ApplyDependencyRelationChoice(selection, row, "unknown"));
        Assert.IsTrue(editor.ApplyDependencyRelationChoice(selection, row, "STARTTOSTART"));
        Assert.IsNull(editor.CaptureDependencyRelationChoice(row, "STARTTOSTART"));
        Assert.IsTrue(editor.IsDirty);
        await editor.LoadDependencyMetadataAsync(TestContext.CancellationToken);
        Assert.AreSame(choices, row.RelationChoices);
        Assert.AreEqual("STARTTOSTART", row.RelationType);
        Assert.IsFalse(editor.OwnsDependencyRelationChoice(selection, row));
        Assert.IsTrue(editor.IsDirty);
        editor.Load(CreateTask("two", "{}"));
        Assert.IsFalse(editor.ApplyDependencyRelationChoice(selection, row, "FINISHTOFINISH"));
        Assert.AreEqual("two", editor.TaskId);
    }

    private static TaskItem CreateTask(string id, string properties) =>
        new(
            id,
            "Task",
            null,
            "open",
            "Open",
            "normal",
            "Normal",
            null,
            null,
            null,
            null,
            [],
            [],
            [],
            false,
            false,
            false,
            false,
            false,
            null,
            ""
        )
        {
            Properties = JsonSerializer.Deserialize<JsonElement>(properties),
            ProfileId = "owner",
            ExpectedRevision = new string('a', 64),
        };

    private sealed class Dispatcher : IUiDispatcher
    {
        public bool HasThreadAccess => true;

        public void Enqueue(Action action) => action();
    }

    /// <summary>Framework cancellation for native worker and asynchronous draft checks.</summary>
    public TestContext TestContext { get; set; } = null!;
}
