using System.Security.Cryptography;
using System.Text.Json;
using TaskNotes.Windows.App.Acceptance;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.E2E;

/// <summary>Exercises the packaged production store against a descriptor-bound private Markdown replica.</summary>
[TestClass, DoNotParallelize]
public sealed partial class StandaloneProductionScenarios
{
    /// <summary>Gets or sets the current serial test context.</summary>
    public required TestContext TestContext { get; set; }

    /// <summary>Proves local capture, exact Undo, owned relaunch and immutable submitted-action recovery.</summary>
    [TestMethod, TestCategory("standalone-production")]
    public async Task StandaloneProductionComposition()
    {
        CancellationToken cancellation = TestContext.CancellationToken;
        var run = await LaunchRunAsync(cancellation);
        var descriptor = run.Descriptor;
        string results = run.Results;
        await using var session = run.Session;
        List<string> passed = [];
        try
        {
            session.InvokeByName("Browse");
            _ = session.WaitForName("E2E existing task", cancellation);
            descriptor.VerifySeedBytes();
            passed.Add("standalone.production-local-vault");
            await session.CaptureScreenshotAsync(
                Path.Combine(results, "01-owned-workspace.png"),
                cancellation
            );

            const string title = "Synthetic Windows acceptance capture";
            session.InvokeByName("New task");
            session.SetValue(AutomationIds.QuickAddInput, title);
            _ = await session.WaitForTextAsync(
                AutomationIds.QuickAddPreview,
                text => text.Contains(title, StringComparison.Ordinal),
                cancellation
            );
            session.InvokeByName("Add task");
            _ = session.WaitForName(title, cancellation);
            string captured = await FindTaskAsync(
                session,
                descriptor.VaultDirectory,
                title,
                cancellation
            );
            byte[] before = await File.ReadAllBytesAsync(captured, cancellation);
            passed.Add("quick-add.preview");
            passed.Add("tasks.created-markdown");
            await session.CaptureScreenshotAsync(
                Path.Combine(results, "02-captured-task.png"),
                cancellation
            );

            UiAutomationSession.ToggleDescendant(session.WaitForName(title, cancellation));
            await session.WaitForPropertyAsync(captured, "status", "done", cancellation);
            session.InvokeByName("Undo last saved change");
            await WaitAsync(
                () => File.ReadAllBytes(captured).AsSpan().SequenceEqual(before),
                cancellation
            );
            passed.Add("completion.plain-undo-exact-bytes");
            await session.RestartAsync(cancellation);
            session.InvokeByName("Browse");
            _ = session.WaitForName(title, cancellation);
            CollectionAssert.AreEqual(before, await File.ReadAllBytesAsync(captured, cancellation));
            passed.Add("package.persisted-local-relaunch");

            string original = captured;
            string generated = await File.ReadAllTextAsync(original, cancellation);
            Assert.IsTrue(
                generated.StartsWith("---\n", StringComparison.Ordinal),
                "The owned capture must have its production-created frontmatter and creation metadata."
            );
            // Only the newly captured synthetic note receives external unknown metadata.
            // Canonical historical fixture bytes remain untouched throughout acceptance.
            await File.WriteAllTextAsync(
                original,
                generated.Insert(
                    4,
                    "custom_property: \"Keep this exact spelling\"\ntimeEstimate: 25\n"
                ),
                cancellation
            );
            session.InvokeByName("Refresh tasks");
            byte[] originalBytes = await File.ReadAllBytesAsync(original, cancellation);
            session.OpenTask(title);
            _ = await session.WaitForTextAsync(
                AutomationIds.EditorTitle,
                text => text == title,
                cancellation
            );
            string journal = Path.Combine(descriptor.EngineDirectory, "mutation-envelopes.json");
            string retained;
            using (
                var deniedReplace = new FileStream(
                    original,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.Read
                )
            )
            {
                session.SetValue(AutomationIds.EditorTitle, "Synthetic recovered Windows edit");
                session.Invoke(AutomationIds.EditorSave);
                retained = await PendingDocumentAsync(journal, cancellation);
                // The retained document is the actual production admission, not a synthesized retry.
                FacetSchema.Bundled().Validate(retained, "retainedMutation");
                await session.RestartAsync(cancellation);
                Assert.AreEqual(retained, await PendingDocumentAsync(journal, cancellation));
                CollectionAssert.AreEqual(
                    originalBytes,
                    await File.ReadAllBytesAsync(original, cancellation)
                );
            }
            session.InvokeByName("Settings");
            _ = session.WaitForAutomationId("Facet.Settings.SavedActions", cancellation);
            session.InvokeByName("Resume saved action");
            string changed = await FindTaskAsync(
                session,
                descriptor.VaultDirectory,
                "Synthetic recovered Windows edit",
                cancellation
            );
            string markdown = await File.ReadAllTextAsync(changed, cancellation);
            Assert.Contains("custom_property: \"Keep this exact spelling\"", markdown);
            Assert.Contains("timeEstimate: 25", markdown);
            await WaitAsync(() => PendingCount(journal) == 0, cancellation);
            passed.Add("recovery.immutable-admission-after-relaunch");
            passed.Add("markdown.opaque-metadata-preserved");
            await ExerciseLocalSurfacesAsync(session, descriptor, passed, cancellation);
            foreach (var seed in descriptor.SeedFiles)
                Assert.AreEqual(
                    seed.Sha256,
                    Convert.ToHexStringLower(
                        SHA256.HashData(
                            await File.ReadAllBytesAsync(
                                descriptor.ResolveSeed(seed.Path),
                                cancellation
                            )
                        )
                    )
                );
            passed.Add("markdown.untouched-and-binary-bytes-preserved");
            session.InvokeByName("Browse");
            await session.CaptureScreenshotAsync(
                Path.Combine(results, "03-resumed-action.png"),
                cancellation
            );
            await WriteEvidenceAsync(descriptor, "standalone-production", passed, cancellation);
        }
        catch (Exception failure)
        {
            using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(10));
            try
            {
                await session.CaptureScreenshotAsync(
                    Path.Combine(results, "failure-owned-window.png"),
                    timeout.Token
                );
            }
            catch (Exception captureFailure)
            {
                throw new AggregateException(
                    "Standalone acceptance failed and its owned-window proof was refused or failed.",
                    failure,
                    captureFailure
                );
            }
            throw;
        }
    }

    private static int PendingCount(string path)
    {
        using var document = JsonDocument.Parse(File.ReadAllBytes(path));
        return document.RootElement.GetProperty("Pending").EnumerateObject().Count();
    }

    private static async Task<string> PendingDocumentAsync(
        string path,
        CancellationToken cancellation
    )
    {
        string? retained = null;
        await WaitAsync(
            () =>
            {
                if (!File.Exists(path))
                    return false;
                using var document = JsonDocument.Parse(File.ReadAllBytes(path));
                var entries = document
                    .RootElement.GetProperty("Pending")
                    .EnumerateObject()
                    .ToArray();
                if (entries.Length == 0)
                    return false;
                Assert.HasCount(
                    1,
                    entries,
                    "A single synthetic edit must own one immutable admission."
                );
                retained = entries[0].Value.GetProperty("Document").GetString();
                return retained is not null;
            },
            cancellation
        );
        return retained ?? throw new AssertFailedException("No production admission was retained.");
    }

    private static async Task<string> FindTaskAsync(
        UiAutomationSession session,
        string vault,
        string title,
        CancellationToken cancellation
    )
    {
        using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellation
        );
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        while (true)
        {
            List<string> matching = [];
            foreach (
                string file in Directory.EnumerateFiles(vault, "*.md", SearchOption.AllDirectories)
            )
            {
                var properties = await session.ReadPropertiesAsync(file, timeout.Token);
                if (properties is not { } value || !value.TryGetProperty("title", out var actual))
                    continue;
                Assert.AreEqual(
                    JsonValueKind.String,
                    actual.ValueKind,
                    "A title must retain its declared scalar type."
                );
                if (actual.GetString() == title)
                    matching.Add(file);
            }
            if (matching.Count > 0)
            {
                Assert.HasCount(
                    1,
                    matching,
                    "A local action must not create duplicate task files."
                );
                await session.WaitForMutationSettlementAsync(timeout.Token);
                return matching[0];
            }
            await Task.Delay(TimeSpan.FromMilliseconds(100), timeout.Token);
        }
    }

    private static async Task WaitAsync(Func<bool> predicate, CancellationToken cancellation)
    {
        using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(
            cancellation
        );
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        while (!predicate())
            await Task.Delay(TimeSpan.FromMilliseconds(100), timeout.Token);
    }

    private static string Required(string name) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException(
                name + " is required by the standalone packaged runner."
            );
}
