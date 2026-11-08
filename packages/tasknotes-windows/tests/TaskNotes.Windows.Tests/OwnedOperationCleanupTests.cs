using TaskNotes.Windows.E2E;

namespace TaskNotes.Windows.Tests;

/// <summary>Pure failure controls for the E2E harness's exact-resource cleanup.</summary>
[TestClass]
public sealed class OwnedOperationCleanupTests
{
    private static readonly string[] ExpectedReleaseOrder = ["operation", "unregister", "destroy"];

    /// <summary>Successful work releases every resource in the declared order.</summary>
    [TestMethod]
    public void SuccessfulOperationRunsEveryCleanupInOrder()
    {
        List<string> calls = [];
        OwnedOperationCleanup.Run(
            () => calls.Add("operation"),
            () => calls.Add("unregister"),
            () => calls.Add("destroy")
        );
        CollectionAssert.AreEqual(ExpectedReleaseOrder, calls);
    }

    /// <summary>Cleanup failures never replace the operation or prevent a later release.</summary>
    [TestMethod]
    public void OperationAndAllCleanupFailuresRemainOrdered()
    {
        InvalidOperationException operation = new("operation");
        IOException unregister = new("unregister");
        InvalidOperationException destroy = new("destroy");
        AggregateException failure = Assert.ThrowsExactly<AggregateException>(() =>
            OwnedOperationCleanup.Run(
                () => throw operation,
                () => throw unregister,
                () => throw destroy
            )
        );
        Assert.HasCount(3, failure.InnerExceptions);
        Assert.AreSame(operation, failure.InnerExceptions[0]);
        Assert.AreSame(unregister, failure.InnerExceptions[1]);
        Assert.AreSame(destroy, failure.InnerExceptions[2]);
        Assert.IsNotNull(operation.StackTrace);
        Assert.IsNotNull(unregister.StackTrace);
        Assert.IsNotNull(destroy.StackTrace);
    }

    /// <summary>A sole operation error keeps its type, instance and original throw site.</summary>
    [TestMethod]
    public void SingleOperationFailureRetainsOriginalException()
    {
        InvalidOperationException expected = new("operation");
        bool released = false;
        InvalidOperationException actual = Assert.ThrowsExactly<InvalidOperationException>(() =>
            OwnedOperationCleanup.Run(() => throw expected, () => released = true)
        );
        Assert.AreSame(expected, actual);
        Assert.IsTrue(released);
        Assert.IsNotNull(actual.StackTrace);
    }

    /// <summary>A failed release retains its type and still allows the next owned resource to close.</summary>
    [TestMethod]
    public void SingleCleanupFailureStillRunsLaterCleanup()
    {
        IOException expected = new("unregister");
        bool destroyed = false;
        IOException actual = Assert.ThrowsExactly<IOException>(() =>
            OwnedOperationCleanup.Run(() => { }, () => throw expected, () => destroyed = true)
        );
        Assert.AreSame(expected, actual);
        Assert.IsTrue(destroyed);
    }
}
