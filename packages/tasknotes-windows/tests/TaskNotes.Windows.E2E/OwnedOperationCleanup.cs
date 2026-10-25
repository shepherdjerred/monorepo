using System.Runtime.ExceptionServices;

namespace TaskNotes.Windows.E2E;

/// <summary>Releases every owned resource while retaining the original operation and cleanup failures.</summary>
internal static class OwnedOperationCleanup
{
    internal static void Run(Action operation, params Action[] cleanup)
    {
        List<Exception> failures = [];
        try
        {
            operation();
        }
        catch (Exception error)
        {
            failures.Add(error);
        }
        foreach (Action release in cleanup)
        {
            try
            {
                release();
            }
            catch (Exception error)
            {
                failures.Add(error);
            }
        }
        if (failures.Count == 1)
            ExceptionDispatchInfo.Capture(failures[0]).Throw();
        if (failures.Count > 1)
            throw new AggregateException(
                "The owned operation or resource cleanup failed.",
                failures
            );
    }
}
