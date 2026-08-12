using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Exercises the generated-binding compatibility gate.</summary>
    [TestClass]
    public sealed class CompatibilityTests
    {
        /// <summary>Loads the native core, validates checksums, and constructs every callback.</summary>
        [TestMethod]
        public async Task GeneratedBindingsLoadNativeCoreAndConstructEveryCallback()
        {
            using TemporaryDirectory directory = new();

            string version = TaskNotesCompatibility.CoreVersion();
            await TaskNotesCompatibility.ValidateAsync(
                directory.Path,
                TestContext.CancellationToken
            );

            Assert.IsFalse(string.IsNullOrWhiteSpace(version));
        }

        /// <summary>Gets or sets the MSTest execution context.</summary>
        public required TestContext TestContext { get; set; }
    }
}
