using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests;

/// <summary>Exercises the production admission authority used by actual store publication.</summary>
[TestClass]
public sealed class FacetNoticeAuthorityTests
{
    /// <summary>Framework cancellation and diagnostics.</summary>
    public TestContext TestContext { get; set; } = null!;

    /// <summary>Admission samples the visible state after a concurrent publication leaves the gate.</summary>
    [TestMethod]
    public async Task AdmissionClearObservesPublicationThatWasStillInsideTheGate()
    {
        var authority = new FacetNoticeAuthority();
        var owner = authority.Capture(authority.Begin(), "p", "mutation");
        string? visible = null;
        string? shell = null;
        bool hadNotice = false;
        var publishing = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        var admitting = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously
        );
        using var release = new ManualResetEventSlim();
        Task publication = Task.Run(() =>
            authority.PublishIfOwned(
                owner,
                "p",
                () =>
                {
                    publishing.SetResult();
                    Assert.IsTrue(release.Wait(TimeSpan.FromSeconds(5)));
                    visible = "Saved";
                    shell = visible;
                }
            )
        );
        await publishing.Task.WaitAsync(TestContext.CancellationToken);
        Task admission = Task.Run(() =>
        {
            admitting.SetResult();
            _ = authority.Begin(() =>
            {
                hadNotice = visible is not null;
                visible = null;
            });
            if (hadNotice)
                shell = visible;
        });
        try
        {
            await admitting.Task.WaitAsync(TestContext.CancellationToken);
        }
        finally
        {
            release.Set();
        }
        await Task.WhenAll(publication, admission);
        Assert.IsTrue(hadNotice);
        Assert.IsNull(visible);
        Assert.IsNull(shell);
        Assert.IsFalse(authority.PublishIfOwned(owner, "p", () => visible = "Stale"));
    }

    /// <summary>A retained notice and old queued publication cannot survive a newly admitted action.</summary>
    [TestMethod]
    public void AdmissionAndClosureFenceAlreadyAssignedAndQueuedNotices()
    {
        var authority = new FacetNoticeAuthority();
        string? visible = null;
        var original = authority.Capture(authority.Begin(), "p", "mutation");
        Assert.IsTrue(authority.PublishIfOwned(original, "p", () => visible = "Saved"));
        var newer = authority.Begin(() => visible = null);
        Assert.IsNull(visible);
        Assert.IsFalse(authority.PublishIfOwned(original, "p", () => visible = "Stale"));
        var queued = authority.Capture(
            new FacetNoticeAdmission(original.RequestGeneration, original.EngineGeneration),
            "p",
            "queued-old"
        );
        Assert.IsFalse(authority.PublishIfOwned(queued, "p", () => visible = "Stale"));
        var current = authority.Capture(newer, "p", "current");
        Assert.IsFalse(authority.PublishIfOwned(current, "q", () => visible = "Foreign"));
        Assert.IsTrue(authority.PublishIfOwned(current, "p", () => visible = "Saved"));
        authority.Close(() => visible = null);
        Assert.IsNull(visible);
        Assert.IsFalse(authority.PublishIfOwned(current, "p", () => visible = "Closed"));
        _ = Assert.ThrowsExactly<ObjectDisposedException>(() => authority.Begin());
    }
}
