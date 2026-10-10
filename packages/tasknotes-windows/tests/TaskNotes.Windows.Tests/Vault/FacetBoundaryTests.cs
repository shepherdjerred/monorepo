using System.Net;
using System.Security.Cryptography;
using TaskNotes.Windows.Host;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Tests;

/// <summary>Independent native boundary and durable recovery contracts.</summary>
[TestClass]
public sealed class FacetBoundaryTests
{
    /// <summary>Background handlers recover only external access failures and propagate internal-contract/storage faults.</summary>
    [TestMethod]
    public void BackgroundFailuresDoNotBlessCorruptContractsOrSqliteAsSuccess()
    {
        foreach (
            Exception expected in new Exception[]
            {
                new FacetAuthorizationRequiredException("Authorize the owning account."),
                new Core.FacetEngineException.Host("provider"),
                new Core.FacetHostException.Io("external filesystem"),
                new Core.FacetHostException.PermissionDenied("provider permission"),
                new Core.FacetHostException.Unavailable("provider unavailable"),
                new UnauthorizedAccessException(),
                new IOException("disk full"),
            }
        )
            Assert.IsNotNull(TaskNotesExceptionPolicy.BackgroundMessage(expected));
        foreach (
            Exception unexpected in new Exception[]
            {
                new InvalidDataException("broken shared schema"),
                new Core.FacetEngineException.Storage("corrupt SQLite"),
                new Core.FacetEngineException.Closed(),
                new Core.CoreException.Invariant("broken internal contract"),
                new InvalidOperationException("unexpected programmer error"),
                new OperationCanceledException("not an owned lifetime cancellation"),
            }
        )
            Assert.IsNull(TaskNotesExceptionPolicy.BackgroundMessage(unexpected));
    }

    /// <summary>Oversized account responses fail before protocol parsing and release every native request.</summary>
    [TestMethod]
    public async Task AccountResponseSizeLimitDoesNotLeakRequestCapacity()
    {
        using HttpClient http = new(new ResponseHandler(new string('x', 4 * 1024 * 1024 + 1)));
        await using ObsidianAccountService account = new(new Secrets(), http);
        for (int index = 0; index < 40; index++)
        {
            var failure = await Assert.ThrowsExactlyAsync<InvalidDataException>(() =>
                account.SignInAsync(
                    "public@example.invalid",
                    "synthetic",
                    "",
                    TestContext.CancellationToken
                )
            );
            Assert.AreEqual("The account response exceeded its limit.", failure.Message);
        }
    }

    /// <summary>Expected storage/provider failures are useful while unknown internal faults remain fatal.</summary>
    [TestMethod]
    public void StandaloneBoundaryErrorsKeepTheirActionableCategories()
    {
        Assert.AreEqual(
            "storage unavailable",
            TaskNotesExceptionPolicy.UserFacingMessage(
                new Core.FacetEngineException.Storage("storage unavailable")
            )
        );
        Assert.AreEqual(
            "host unavailable",
            TaskNotesExceptionPolicy.UserFacingMessage(
                new Core.FacetEngineException.Host("host unavailable")
            )
        );
        Assert.AreEqual(
            "invalid action",
            TaskNotesExceptionPolicy.UserFacingMessage(
                new Core.FacetEngineException.Validation("invalid action")
            )
        );
        Assert.AreEqual(
            "settings required",
            TaskNotesExceptionPolicy.UserFacingMessage(
                new Core.FacetEngineException.Configuration("settings required")
            )
        );
        StringAssert.Contains(
            TaskNotesExceptionPolicy.UserFacingMessage(new Core.FacetEngineException.Conflict())!,
            "preserved conflict",
            StringComparison.Ordinal
        );
        StringAssert.Contains(
            TaskNotesExceptionPolicy.UserFacingMessage(new Core.FacetEngineException.NotFound())!,
            "no longer exists",
            StringComparison.Ordinal
        );
        Assert.AreEqual(
            "The vault filesystem operation failed.",
            TaskNotesExceptionPolicy.UserFacingMessage(
                new Core.FacetHostException.Io("private filesystem detail")
            )
        );
        Assert.AreEqual(
            "Select the vault folder again to restore access.",
            TaskNotesExceptionPolicy.UserFacingMessage(
                new Core.FacetHostException.PermissionDenied("private filesystem detail")
            )
        );
        Assert.AreEqual(
            "The vault provider is unavailable.",
            TaskNotesExceptionPolicy.UserFacingMessage(
                new Core.FacetHostException.Unavailable("private filesystem detail")
            )
        );
        Assert.IsFalse(
            TaskNotesExceptionPolicy
                .UserFacingMessage(new IOException("private filesystem detail"))!
                .Contains("private filesystem detail", StringComparison.Ordinal)
        );
        Assert.IsFalse(
            TaskNotesExceptionPolicy
                .UserFacingMessage(new UnauthorizedAccessException("private filesystem detail"))!
                .Contains("private filesystem detail", StringComparison.Ordinal)
        );
        Assert.IsNull(
            TaskNotesExceptionPolicy.UserFacingMessage(
                new InvalidOperationException("internal contract failure")
            )
        );
        Assert.IsNull(
            TaskNotesExceptionPolicy.UserFacingMessage(new Core.FacetEngineException.Closed())
        );
    }

    /// <summary>Directory tombstones preserve nonempty contents, and external capabilities stay read-only.</summary>
    [TestMethod]
    public void RemoteDirectoriesPreserveContentsAndRejectExternalWrites()
    {
        using TemporaryDirectory temporary = new();
        string root = PhysicalTemporaryPath(temporary.Path);
        FacetVaultFiles files = new();
        files.Register("p", root, exclusiveReplica: true);
        files.ApplyDirectory("p", "Nested/Folder", false);
        string target = Path.Combine(root, "Nested", "Folder");
        Assert.IsTrue(Directory.Exists(target));
        File.WriteAllText(Path.Combine(target, "preserved.md"), "preserved");
        files.ApplyDirectory("p", "Nested/Folder", true);
        Assert.AreEqual("preserved", File.ReadAllText(Path.Combine(target, "preserved.md")));
        File.Delete(Path.Combine(target, "preserved.md"));
        files.ApplyDirectory("p", "Nested/Folder", true);
        Assert.IsFalse(Directory.Exists(target));
        files.ApplyDirectory("p", "Nested/Folder", true);
        files.Register("external", root);
        _ = Assert.ThrowsExactly<Core.FacetHostException.PermissionDenied>(() =>
            files.ApplyDirectory("external", "Denied", false)
        );
        Assert.IsFalse(Directory.Exists(Path.Combine(root, "Denied")));
        _ = Assert.ThrowsExactly<ArgumentException>(() =>
            files.ApplyDirectory("p", "../Denied", false)
        );
    }

    /// <summary>Retains exact old bytes until acknowledgement and survives adapter relaunch.</summary>
    [TestMethod]
    public void AtomicReplacementRetainsDisplacedBytesAcrossRelaunch()
    {
        using TemporaryDirectory temporary = new();
        string root = PhysicalTemporaryPath(temporary.Path);
        File.WriteAllText(Path.Combine(root, "note.md"), "old");
        FacetVaultFiles files = new();
        files.Register("p", root, exclusiveReplica: true);
        string expected = Convert.ToHexStringLower(SHA256.HashData("old"u8));
        var exchange = files.CompareExchange("p", "note.md", expected, "new"u8.ToArray());
        Assert.IsTrue(exchange.Applied);
        CollectionAssert.AreEqual("old"u8.ToArray(), exchange.DisplacedBytes);
        FacetVaultFiles reopened = new();
        reopened.Register("p", root, exclusiveReplica: true);
        var versions = reopened.DisplacedMetadata("p", null, 128);
        Assert.HasCount(1, versions);
        Assert.AreEqual("note.md", versions[0].Path);
        Assert.AreEqual(3UL, versions[0].Size);
        Assert.AreEqual(expected, versions[0].Revision);
        CollectionAssert.AreEqual("old"u8.ToArray(), reopened.ReadDisplaced("p", versions[0].Id));
        string[] paths = reopened.ListFiles("p");
        Assert.HasCount(1, paths);
        Assert.AreEqual("note.md", paths[0]);
        reopened.AcknowledgeDisplaced("p", versions[0].Id);
        Assert.IsEmpty(reopened.DisplacedMetadata("p", null, 128));
    }

    /// <summary>Crash recovery hashes the actual retained bytes and rejects replaced backup links.</summary>
    [TestMethod]
    public void PreparedBackupRecoverySealsActualBytesAndRejectsLeafLinks()
    {
        using TemporaryDirectory temporary = new();
        string root = PhysicalTemporaryPath(temporary.Path);
        File.WriteAllText(Path.Combine(root, "note.md"), "before");
        FacetVaultFiles files = new();
        files.Register("p", root, exclusiveReplica: true);
        var exchange = files.CompareExchange(
            "p",
            "note.md",
            Convert.ToHexStringLower(SHA256.HashData("before"u8)),
            "after"u8.ToArray()
        );
        Assert.IsTrue(exchange.Applied);
        string backup = Directory
            .GetFiles(
                Path.Combine(root, ".facet-private-backups"),
                "*.bytes",
                SearchOption.AllDirectories
            )
            .Single();
        string metadata = Path.ChangeExtension(backup, ".json");
        File.WriteAllText(metadata, "{\"Path\":\"note.md\"}");
        var recovered = files.DisplacedMetadata("p", null, 1).Single();
        Assert.AreEqual(6UL, recovered.Size);
        Assert.AreEqual(Convert.ToHexStringLower(SHA256.HashData("before"u8)), recovered.Revision);
        Assert.IsEmpty(files.DisplacedMetadata("p", recovered.Id, 1));
        CollectionAssert.AreEqual("before"u8.ToArray(), files.ReadDisplaced("p", recovered.Id));
        if (!OperatingSystem.IsWindows())
        {
            File.Delete(backup);
            File.CreateSymbolicLink(backup, Path.Combine(root, "note.md"));
            _ = Assert.ThrowsExactly<Core.FacetHostException.PermissionDenied>(() =>
                files.DisplacedMetadata("p", null, 1)
            );
            _ = Assert.ThrowsExactly<Core.FacetHostException.PermissionDenied>(() =>
                files.ReadDisplaced("p", recovered.Id)
            );
        }
    }

    /// <summary>Missing legacy capture bytes never authorize erasing their immutable recovery record.</summary>
    [TestMethod]
    public void MissingLegacyCapturePreservesPreparedAndRecordedMetadata()
    {
        using TemporaryDirectory temporary = new();
        string root = PhysicalTemporaryPath(temporary.Path);
        string target = Path.Combine(root, "note.md");
        File.WriteAllText(target, "current");
        FacetVaultFiles files = new();
        files.Register("p", root, exclusiveReplica: true);
        string directory = Path.Combine(
            root,
            ".facet-private-backups",
            Convert.ToHexStringLower(SHA256.HashData("p"u8))
        );
        Directory.CreateDirectory(directory);
        string revision = Convert.ToHexStringLower(SHA256.HashData("current"u8));
        foreach (
            string record in new[]
            {
                "{\"Path\":\"note.md\"}",
                "{\"Path\":\"note.md\",\"Size\":7,\"Revision\":\"" + revision + "\"}",
            }
        )
        {
            string metadata = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".json");
            File.WriteAllText(metadata, record);
            byte[] original = File.ReadAllBytes(metadata);
            var failure = Assert.ThrowsExactly<Core.FacetHostException.Unavailable>(() =>
                files.DisplacedMetadata("p", null, 128)
            );
            StringAssert.Contains(failure.Message, "legacy recovery", StringComparison.Ordinal);
            CollectionAssert.AreEqual(original, File.ReadAllBytes(metadata));
            Assert.AreEqual("current", File.ReadAllText(target));
            Assert.IsFalse(File.Exists(Path.ChangeExtension(metadata, ".bytes")));
            File.Delete(metadata);
        }
    }

    /// <summary>Does not overwrite a stale read, normalize traversal, or follow a leaf link.</summary>
    [TestMethod]
    public void CapabilityRejectsStaleRevisionAndUnsafePaths()
    {
        using TemporaryDirectory temporary = new();
        string root = PhysicalTemporaryPath(temporary.Path);
        File.WriteAllText(Path.Combine(root, "note.md"), "current");
        FacetVaultFiles files = new();
        files.Register("p", root, exclusiveReplica: true);
        Assert.IsFalse(files.CompareExchange("p", "note.md", "stale", "new"u8.ToArray()).Applied);
        Assert.AreEqual("current", File.ReadAllText(Path.Combine(root, "note.md")));
        _ = Assert.ThrowsExactly<ArgumentException>(() => files.ReadFile("p", "../note.md"));
        _ = Assert.ThrowsExactly<ArgumentException>(() => files.ReadFile("p", "C:/note.md"));
        _ = Assert.ThrowsExactly<ArgumentException>(() =>
            files.ReadFile("p", ".facet-private-backups/version.bytes")
        );
        foreach (
            string path in new[]
            {
                ".FACET-PRIVATE-BACKUPS/x",
                ".Facet-Write-x",
                "foo. /note.md",
                "CON.md",
                "LPT9/a.md",
                "com¹.txt",
                "PRN",
                "AUX.md",
                "NUL.md",
                "CONIN$.md",
                "CONOUT$.md",
                "COM1.md",
            }
        )
            _ = Assert.ThrowsExactly<ArgumentException>(() => files.ReadFile("p", path));
        // Portable link test exercises ordinary rejection. Windows final-entry
        // race/handle sharing and power-loss tests remain a real Windows gate.
        if (!OperatingSystem.IsWindows())
        {
            File.CreateSymbolicLink(Path.Combine(root, "link.md"), Path.Combine(root, "note.md"));
            _ = Assert.ThrowsExactly<Core.FacetHostException.PermissionDenied>(() =>
                files.ReadFile("p", "link.md")
            );
        }
    }

    /// <summary>Native HTTP failure releases request capacity and local logout clears secure state.</summary>
    [TestMethod]
    public async Task AccountTransportFailuresReleaseRequestsAndLogoutSecrets()
    {
        Secrets secrets = new();
        using HttpClient http = new(new OfflineHandler());
        await using ObsidianAccountService account = new(secrets, http);
        for (int index = 0; index < 40; index++)
            _ = await Assert.ThrowsExactlyAsync<HttpRequestException>(() =>
                account.SignInAsync(
                    "public@example.invalid",
                    "synthetic",
                    "",
                    TestContext.CancellationToken
                )
            );
        secrets.Save("obsidian/account-token", "synthetic");
        secrets.Save("obsidian/vault-key/p", "synthetic");
        _ = await Assert.ThrowsExactlyAsync<HttpRequestException>(() =>
            account.SignOutAsync(["p"], TestContext.CancellationToken)
        );
        Assert.IsNull(secrets.Read("obsidian/account-token"));
        Assert.IsNull(secrets.Read("obsidian/vault-key/p"));
    }

    /// <summary>Parsing consumes requests once and preserves the original error category.</summary>
    [TestMethod]
    public async Task RejectedAndMalformedResponsesDoNotBecomeCancellationErrors()
    {
        foreach (
            (string body, string code) in new[]
            {
                ("{\"error\":\"Wrong credentials\"}", "account_rejected"),
                ("not-json", "protocol"),
            }
        )
        {
            using HttpClient http = new(new ResponseHandler(body));
            await using ObsidianAccountService account = new(new Secrets(), http);
            for (int index = 0; index < 40; index++)
            {
                var error =
                    await Assert.ThrowsExactlyAsync<Core.ObsidianBoundaryException.Boundary>(() =>
                        account.SignInAsync(
                            "public@example.invalid",
                            "synthetic",
                            "",
                            TestContext.CancellationToken
                        )
                    );
                Assert.AreEqual(code, error.code);
            }
        }
    }

    /// <summary>Authorization generations cannot pair a new account token with an old vault key.</summary>
    [TestMethod]
    public async Task AccountSwitchInvalidatesPriorProfileOwnership()
    {
        Secrets secrets = new();
        using HttpClient http = new(
            new ResponseHandler(
                "{\"token\":\"synthetic\",\"name\":\"Fixture\",\"email\":\"public@example.invalid\"}"
            )
        );
        await using ObsidianAccountService account = new(secrets, http);
        await account.SignInAsync(
            "public@example.invalid",
            "synthetic",
            "",
            TestContext.CancellationToken
        );
        string original = account.AccountOwner;
        secrets.Save(
            ObsidianAccountService.KeyIdentity(original, "p", "v"),
            Convert.ToBase64String(new byte[32])
        );
        await account.SignInAsync(
            "other@example.invalid",
            "synthetic",
            "",
            TestContext.CancellationToken
        );
        Assert.AreNotEqual(original, account.AccountOwner);
        _ = Assert.ThrowsExactly<FacetAuthorizationRequiredException>(() =>
            account.SessionCredentials(original, "p", "v")
        );
    }

    /// <summary>Gets or sets the test cancellation context.</summary>
    public required TestContext TestContext { get; set; }

    private static string PhysicalTemporaryPath(string path) =>
        OperatingSystem.IsMacOS() && path.StartsWith("/var/", StringComparison.Ordinal)
            ? "/private" + path
            : path;

    private sealed class Secrets : IFacetSecretStore
    {
        private readonly Dictionary<string, string> _values = [];

        public string? Read(string identity) => _values.GetValueOrDefault(identity);

        public void Save(string identity, string value) => _values[identity] = value;

        public void Remove(string identity) => _values.Remove(identity);
    }

    private sealed class OfflineHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        ) =>
            Task.FromException<HttpResponseMessage>(
                new HttpRequestException(
                    "Synthetic offline transport.",
                    null,
                    HttpStatusCode.ServiceUnavailable
                )
            );
    }

    private sealed class ResponseHandler(string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        ) =>
            Task.FromResult(
                new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(request.Method == HttpMethod.Options ? "" : body),
                }
            );
    }
}
