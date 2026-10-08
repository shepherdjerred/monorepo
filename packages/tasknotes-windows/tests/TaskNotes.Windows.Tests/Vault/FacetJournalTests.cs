using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Durable host retry identity and Undo history reject stale observations without changing disk.</summary>
[TestClass]
public sealed class FacetJournalTests
{
    /// <summary>Historical compatibility does not admit malformed commands or reset their retained bytes.</summary>
    [TestMethod]
    public void MalformedHistoricalCommandCannotBypassStartupValidation()
    {
        using TemporaryDirectory directory = new();
        var journal = new FacetMutationJournal(directory.Path);
        _ = journal.Prepare("owner", new { kind = "start_time" });
        string file = Path.Combine(directory.Path, "mutation-envelopes.json");
        byte[] before = File.ReadAllBytes(file);
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            new FacetMutationJournal(directory.Path)
        );
        CollectionAssert.AreEqual(before, File.ReadAllBytes(file));
    }

    /// <summary>Completion observation is atomic and cannot add duplicate history or pop another receipt.</summary>
    [TestMethod]
    public void StaleObservationsCannotChangeDurableUndoHistory()
    {
        using TemporaryDirectory directory = new();
        var journal = new FacetMutationJournal(directory.Path);
        var first = journal.Prepare(
            "owner",
            new
            {
                kind = "set_completion",
                path = "one.md",
                completed = true,
            }
        );
        journal.Complete(first, true);
        Assert.AreEqual(first.Id, journal.UndoHead("owner"));
        _ = Assert.ThrowsExactly<InvalidOperationException>(() => journal.Complete(first, true));
        Assert.AreEqual(1, new FacetMutationJournal(directory.Path).UndoDepth("owner"));
        var second = journal.Prepare(
            "owner",
            new
            {
                kind = "set_completion",
                path = "two.md",
                completed = true,
            }
        );
        journal.Complete(second, true);
        var undo = journal.Prepare("owner", new { kind = "undo", receiptId = first.Id });
        _ = Assert.ThrowsExactly<InvalidOperationException>(() =>
            journal.Complete(undo, false, first.Id)
        );
        Assert.AreEqual(second.Id, new FacetMutationJournal(directory.Path).UndoHead("owner"));
        Assert.AreEqual(undo.Id, journal.PendingEntries.Single().Id);
        _ = Assert.ThrowsExactly<InvalidOperationException>(() =>
            journal.RetireRejected(undo with { Document = "{}" })
        );
        journal.RetireRejected(undo);
        Assert.AreEqual(2, journal.UndoDepth("owner"));
        var foreign = journal.Prepare("foreign", new { kind = "undo", receiptId = second.Id });
        _ = Assert.ThrowsExactly<InvalidOperationException>(() =>
            journal.Complete(foreign, false, second.Id)
        );
        Assert.AreEqual(0, journal.UndoDepth("foreign"));
        journal.RetireRejected(foreign);
        Assert.IsNull(journal.UndoHead("foreign"));
        Assert.IsNull(journal.Pending("owner", "unknown"));
    }

    /// <summary>Invalid durable root/version is reported explicitly instead of resetting retained identities.</summary>
    [TestMethod]
    [DataRow("null")]
    [DataRow("{\"SchemaVersion\":2,\"Pending\":{},\"Undo\":{}}")]
    public void CorruptOrUnknownJournalIsNeverReset(string json)
    {
        using TemporaryDirectory directory = new();
        string file = Path.Combine(directory.Path, "mutation-envelopes.json");
        File.WriteAllText(file, json);
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            new FacetMutationJournal(directory.Path)
        );
        Assert.AreEqual(json, File.ReadAllText(file));
    }
}
