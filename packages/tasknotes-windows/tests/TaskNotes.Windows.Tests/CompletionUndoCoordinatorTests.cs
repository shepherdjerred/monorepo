using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Exercises completion undo ordering, bounds, and partial-dispatch recovery.</summary>
    [TestClass]
    public sealed class CompletionUndoCoordinatorTests
    {
        private static readonly string[] ExpectedPartialDispatchOrder = ["second.md", "first.md"];

        /// <summary>Retries only restores that did not dispatch before a partial failure.</summary>
        [TestMethod]
        public void PartialUndoRetainsOnlyUndispatchedRestores()
        {
            CompletionUndoCoordinator coordinator = new();
            coordinator.Push(
                "Completed two tasks",
                [
                    new CompletionRestore("first.md", Core.TaskStatus.Waiting, null),
                    new CompletionRestore("second.md", Core.TaskStatus.Open, null),
                ]
            );
            List<string> dispatched = [];
            int attempts = 0;

            Assert.ThrowsExactly<InvalidOperationException>(() =>
                coordinator.Undo(command =>
                {
                    attempts++;
                    if (attempts == 2)
                    {
                        throw new InvalidOperationException("injected partial failure");
                    }
                    dispatched.Add(TaskId(command));
                })
            );

            Assert.AreEqual(1, coordinator.Depth);
            Assert.IsTrue(coordinator.CanUndo);
            coordinator.Undo(command => dispatched.Add(TaskId(command)));
            CollectionAssert.AreEqual(ExpectedPartialDispatchOrder, dispatched);
            Assert.AreEqual(0, coordinator.Depth);
            Assert.IsFalse(coordinator.CanUndo);
        }

        /// <summary>Keeps only the ten most recent undo groups.</summary>
        [TestMethod]
        public void UndoDepthIsBoundedAndRequiresRestores()
        {
            CompletionUndoCoordinator coordinator = new();
            Assert.ThrowsExactly<ArgumentException>(() => coordinator.Push("empty", []));

            for (int index = 0; index < 12; index++)
            {
                coordinator.Push(
                    $"entry {index}",
                    [new CompletionRestore($"task-{index}.md", Core.TaskStatus.Open, null)]
                );
            }

            Assert.AreEqual(10, coordinator.Depth);
            coordinator.Clear();
            Assert.AreEqual(0, coordinator.Depth);
            coordinator.Undo(_ => Assert.Fail("An empty undo stack must not dispatch."));
        }

        private static string TaskId(Core.CommandInput command)
        {
            return command is Core.CommandInput.SetStatus status
                ? status.TaskId
                : throw new AssertFailedException("Expected a status restore command.");
        }
    }
}
