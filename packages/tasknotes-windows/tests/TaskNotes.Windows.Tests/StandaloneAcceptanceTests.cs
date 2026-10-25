using System.Security.Cryptography;
using System.Text.Json;
using TaskNotes.Windows.App.Acceptance;

namespace TaskNotes.Windows.Tests;

/// <summary>Real private-path guards for the E2E-only standalone application bootstrap.</summary>
[TestClass]
public sealed class StandaloneAcceptanceTests
{
    private static string Schema()
    {
        using var stream =
            typeof(StandaloneAcceptanceTests).Assembly.GetManifestResourceStream(
                "StandaloneAcceptanceSchema.json"
            ) ?? throw new InvalidDataException("The neutral acceptance schema is missing.");
        using StreamReader reader = new(stream);
        return reader.ReadToEnd();
    }

    /// <summary>Only initial registration requires original bytes; a normal restart keeps edited task bytes.</summary>
    [TestMethod]
    public void BootstrapUsesOneOwnedPrivateProfileAndAllowsPersistedTaskChanges()
    {
        using Fixture fixture = new();
        var first = fixture.Open();
        first.Prepare();
        string edited = "persisted synthetic edit\n";
        File.WriteAllText(fixture.SeedPath, edited);
        fixture.Open().Prepare();
        Assert.AreEqual(edited, File.ReadAllText(fixture.SeedPath));
        var catalog = new Host.FacetProfileCatalog(first.Descriptor.EngineDirectory);
        Assert.HasCount(1, catalog.Profiles);
        var profile = catalog.Profiles[0];
        Assert.AreEqual(first.Descriptor.ProfileId, profile.Id);
        Assert.AreEqual(first.Descriptor.VaultDirectory, profile.RootPath);
        Assert.IsTrue(profile.PrivateReplica);
        Assert.IsFalse(profile.ApproveStandard);
        Assert.IsNull(profile.AccountOwner);
        Assert.IsNull(profile.Vault);
    }

    /// <summary>Incorrect initial seeds cannot establish a writable profile.</summary>
    [TestMethod]
    public void ChangedSeedBytesRejectBeforeProfileRegistration()
    {
        using Fixture fixture = new();
        File.WriteAllText(fixture.SeedPath, "changed before registration");
        var bootstrap = fixture.Open();
        _ = Assert.ThrowsExactly<InvalidDataException>(bootstrap.Prepare);
        Assert.IsFalse(
            File.Exists(Path.Combine(bootstrap.Descriptor.EngineDirectory, "profiles.json"))
        );
        Assert.IsFalse(
            File.Exists(
                Path.Combine(bootstrap.Descriptor.EngineDirectory, "bootstrap-receipt.json")
            )
        );
    }

    /// <summary>The initial vault is exactly the hashed seed inventory, never an unlisted additional capability.</summary>
    [TestMethod]
    public void UndeclaredSeedFileRejectsBeforeRegistration()
    {
        using Fixture fixture = new();
        File.WriteAllText(
            Path.Combine(Path.GetDirectoryName(fixture.SeedPath)!, "undeclared.md"),
            "synthetic extra file"
        );
        var bootstrap = fixture.Open();
        _ = Assert.ThrowsExactly<InvalidDataException>(bootstrap.Prepare);
        Assert.IsFalse(
            File.Exists(Path.Combine(bootstrap.Descriptor.EngineDirectory, "profiles.json"))
        );
    }

    /// <summary>The run, package, private state and selected profile are all independent identity fences.</summary>
    [TestMethod]
    public void WrongOwnerAndUnknownDescriptorFieldsFailClosed()
    {
        foreach (
            string field in new[]
            {
                "runId",
                "profileId",
                "stateDirectory",
                "packageFamilyName",
                "unknown",
            }
        )
        {
            using Fixture fixture = new();
            var document = fixture.Document();
            document[field] = field switch
            {
                "runId" => Guid.NewGuid().ToString("D"),
                "profileId" => "another-profile",
                "stateDirectory" => fixture.LocalState,
                "packageFamilyName" => "red.sjer.TaskNotes.E2E_0000000000000",
                _ => true,
            };
            fixture.Write(document);
            _ = Assert.ThrowsExactly<InvalidDataException>(() => fixture.Open(), field);
        }
    }

    /// <summary>Descriptor location must match its run, even when its content is otherwise valid.</summary>
    [TestMethod]
    public void DescriptorCannotBeLoadedFromAnotherLocation()
    {
        using Fixture fixture = new();
        string copied = Path.Combine(fixture.LocalState, "descriptor.json");
        File.Copy(fixture.DescriptorPath, copied);
        _ = Assert.ThrowsExactly<InvalidDataException>(() =>
            StandaloneAcceptanceDescriptor.Read(
                copied,
                fixture.LocalState,
                Fixture.Family,
                Schema()
            )
        );
    }

    /// <summary>Traversal, ADS, device names and aliases cannot become seed capabilities.</summary>
    [TestMethod]
    public void InvalidSeedPathsRejectBeforeAnyFileRead()
    {
        foreach (
            string relative in new[]
            {
                "../outside.md",
                "/outside.md",
                "task\\outside.md",
                "task.md:stream",
                "CON",
                "COM1.md",
                "dir./task.md",
                "dir /task.md",
                "a//b.md",
            }
        )
        {
            using Fixture fixture = new();
            var document = fixture.Document();
            document["seedFiles"] = new[] { new { path = relative, sha256 = new string('0', 64) } };
            fixture.Write(document);
            _ = Assert.ThrowsExactly<InvalidDataException>(() => fixture.Open(), relative);
        }
    }

    /// <summary>Duplicate keys and duplicate path ownership cannot be normalized away.</summary>
    [TestMethod]
    public void DuplicateDescriptorFieldsAndSeedPathsReject()
    {
        using Fixture fixture = new();
        string json = File.ReadAllText(fixture.DescriptorPath);
        File.WriteAllText(fixture.DescriptorPath, json.Insert(1, "\"schemaVersion\":1,"));
        _ = Assert.ThrowsExactly<InvalidDataException>(() => fixture.Open());
        var document = fixture.Document();
        var seed = new { path = "tasknotes.yaml", sha256 = fixture.SeedHash };
        document["seedFiles"] = new[] { seed, seed };
        fixture.Write(document);
        _ = Assert.ThrowsExactly<InvalidDataException>(() => fixture.Open());
        document["seedFiles"] = new[]
        {
            new { path = "tasknotes.yaml", sha256 = fixture.SeedHash },
            new { path = "TASKNOTES.yaml", sha256 = fixture.SeedHash },
        };
        fixture.Write(document);
        _ = Assert.ThrowsExactly<InvalidDataException>(() => fixture.Open());
    }

    /// <summary>A reparse link is never a permitted descriptor, parent or seed.</summary>
    [TestMethod]
    public void LinkedSeedRejectsBeforeRegistration()
    {
        using Fixture fixture = new();
        string outside = Path.Combine(fixture.LocalState, "outside.yaml");
        File.Move(fixture.SeedPath, outside);
        File.CreateSymbolicLink(fixture.SeedPath, outside);
        var bootstrap = fixture.Open();
        _ = Assert.ThrowsExactly<InvalidDataException>(bootstrap.Prepare);
        Assert.IsFalse(
            File.Exists(Path.Combine(bootstrap.Descriptor.EngineDirectory, "profiles.json"))
        );
    }

    /// <summary>A committed bootstrap receipt cannot recreate a missing or foreign profile silently.</summary>
    [TestMethod]
    public void MissingCatalogOrChangedBootstrapOwnerRejectsRestart()
    {
        using Fixture fixture = new();
        var bootstrap = fixture.Open();
        bootstrap.Prepare();
        string catalogPath = Path.Combine(bootstrap.Descriptor.EngineDirectory, "profiles.json");
        File.Delete(catalogPath);
        _ = Assert.ThrowsExactly<InvalidDataException>(() => fixture.Open().Prepare());
        Assert.IsFalse(File.Exists(catalogPath));
    }

    /// <summary>A descriptor cannot change between read and registration or after a receipt binds its first bootstrap.</summary>
    [TestMethod]
    public void ChangedDescriptorAndReceiptOwnerRejectWithoutResettingTheRun()
    {
        using Fixture fixture = new();
        var prepared = fixture.Open();
        File.AppendAllText(fixture.DescriptorPath, "\n");
        _ = Assert.ThrowsExactly<InvalidDataException>(prepared.Prepare);
        Assert.IsFalse(
            File.Exists(Path.Combine(prepared.Descriptor.EngineDirectory, "profiles.json"))
        );
        fixture.Open().Prepare();
        string catalog = Path.Combine(prepared.Descriptor.EngineDirectory, "profiles.json");
        byte[] before = File.ReadAllBytes(catalog);
        string receiptPath = Path.Combine(
            prepared.Descriptor.EngineDirectory,
            "bootstrap-receipt.json"
        );
        using var receipt = JsonDocument.Parse(File.ReadAllText(receiptPath));
        var wrong = receipt
            .RootElement.EnumerateObject()
            .ToDictionary(
                property => property.Name,
                property => property.Value.Clone(),
                StringComparer.Ordinal
            );
        wrong["runId"] = JsonSerializer.SerializeToElement(Guid.NewGuid().ToString("D"));
        File.WriteAllText(receiptPath, JsonSerializer.Serialize(wrong));
        _ = Assert.ThrowsExactly<InvalidDataException>(() => fixture.Open().Prepare());
        CollectionAssert.AreEqual(before, File.ReadAllBytes(catalog));
    }

    private sealed class Fixture : IDisposable
    {
        internal const string Family = "red.sjer.TaskNotes.E2E_1234567890123";
        internal string LocalState { get; }
        internal string StateDirectory { get; }
        internal string SeedPath { get; }
        internal string DescriptorPath { get; }
        internal string RunId { get; } = Guid.NewGuid().ToString("D");
        internal string SeedHash { get; }

        internal Fixture()
        {
            string temporary = Path.Combine(
                Path.GetTempPath(),
                "facet-windows-acceptance-" + Guid.NewGuid().ToString("N")
            );
            LocalState =
                OperatingSystem.IsMacOS() && temporary.StartsWith("/var/", StringComparison.Ordinal)
                    ? "/private" + temporary
                    : temporary;
            StateDirectory = Path.Combine(LocalState, "StandaloneAcceptance", RunId);
            string vault = Path.Combine(StateDirectory, "vault");
            Directory.CreateDirectory(vault);
            SeedPath = Path.Combine(vault, "tasknotes.yaml");
            File.WriteAllText(SeedPath, "title:\n  storage: frontmatter\n");
            SeedHash = Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(SeedPath)));
            DescriptorPath = Path.Combine(StateDirectory, "descriptor.json");
            Write(Document());
        }

        internal Dictionary<string, object> Document() =>
            new()
            {
                ["schemaVersion"] = 1,
                ["runId"] = RunId,
                ["packageFamilyName"] = Family,
                ["profileId"] = "acceptance-" + RunId,
                ["stateDirectory"] = StateDirectory,
                ["seedFiles"] = new[] { new { path = "tasknotes.yaml", sha256 = SeedHash } },
            };

        internal void Write(Dictionary<string, object> document) =>
            File.WriteAllText(DescriptorPath, JsonSerializer.Serialize(document));

        internal StandaloneAcceptanceBootstrap Open() =>
            new(DescriptorPath, LocalState, Family, Schema());

        public void Dispose() => Directory.Delete(LocalState, true);
    }
}
