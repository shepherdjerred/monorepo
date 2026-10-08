using System.Net;
using System.Net.WebSockets;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests;

/// <summary>Production account/profile and portable settings actions over actual native effects.</summary>
[TestClass]
public sealed class FacetOnboardingTests
{
    /// <summary>After authoritative core deletion, failed profile-only key cleanup retains its intent and reconciles selection before retry.</summary>
    [TestMethod]
    public async Task RemovedProfileCleanupFailureKeepsOtherAccountRightsAndRetriesOriginalIntent()
    {
        using TemporaryDirectory temporary = new();
        string directory = Path.Combine(PhysicalPath(temporary.Path), "state");
        using HttpClient http = new(new AccountTranscript());
        MemorySecrets secrets = new();
        await using var store = FacetPortableCapability.Store(
            directory,
            secrets,
            http,
            () => new OfflineSocket()
        );
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        await store.SignInAsync(
            "fixture@example.invalid",
            "synthetic",
            "",
            TestContext.CancellationToken
        );
        var vault = (await store.ListVaultsAsync(TestContext.CancellationToken)).Single();
        await store.AddRemoteProfileAsync(vault, null, true, TestContext.CancellationToken);
        string first = store.SelectedProfileId!;
        await store.AddRemoteProfileAsync(vault, null, true, TestContext.CancellationToken);
        string second = store.SelectedProfileId!;
        await store.SelectProfileAsync(first, TestContext.CancellationToken);
        secrets.RejectVaultRemoval = true;
        _ = await Assert.ThrowsExactlyAsync<AggregateException>(() =>
            store.RemoveProfileAsync(first, TestContext.CancellationToken)
        );
        Assert.AreEqual(second, store.SelectedProfileId);
        Assert.AreEqual(second, store.Profiles.Single().Id);
        Assert.AreEqual(first, new FacetProfileCatalog(directory).PendingRemovals.Single().Id);
        Assert.AreEqual(4, secrets.Count); // Shared owner/token plus both original profile-qualified keys.
        secrets.RejectVaultRemoval = false;
        await store.RemoveProfileAsync(first, TestContext.CancellationToken);
        Assert.IsEmpty(new FacetProfileCatalog(directory).PendingRemovals);
        Assert.AreEqual(second, store.SelectedProfileId);
        Assert.AreEqual(3, secrets.Count);
        await store.ReauthorizeProfileAsync(second, null, TestContext.CancellationToken);
        Assert.AreEqual(3, secrets.Count);
    }

    /// <summary>Authorization is removed if private replica allocation fails before profile commit.</summary>
    [TestMethod]
    public async Task FailedReplicaCreationDoesNotOrphanASecureVaultKey()
    {
        using TemporaryDirectory temporary = new();
        string directory = Path.Combine(PhysicalPath(temporary.Path), "state");
        using HttpClient http = new(new AccountTranscript());
        MemorySecrets secrets = new();
        await using FacetTaskNotesStore store = FacetPortableCapability.Store(
            directory,
            secrets,
            http,
            () => new OfflineSocket()
        );
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        await store.SignInAsync(
            "fixture@example.invalid",
            "synthetic",
            "",
            TestContext.CancellationToken
        );
        int before = secrets.Count;
        var vault = (await store.ListVaultsAsync(TestContext.CancellationToken)).Single();
        await File.WriteAllTextAsync(
            Path.Combine(directory, "Replicas"),
            "Occupied directory entry",
            TestContext.CancellationToken
        );
        _ = await Assert.ThrowsAsync<IOException>(() =>
            store.AddRemoteProfileAsync(vault, null, true, TestContext.CancellationToken)
        );
        Assert.AreEqual(before, secrets.Count);
        Assert.IsEmpty(store.Profiles);
    }

    /// <summary>MFA, discovery, two replicas, local selection, reauthorization and logout preserve ownership.</summary>
    [TestMethod]
    public async Task SettingsAccountLifecycleKeepsEveryReplicaAndClearsOwnedSecrets()
    {
        using TemporaryDirectory temporary = new();
        string root = PhysicalPath(temporary.Path);
        using HttpClient http = new(new AccountTranscript(mfa: true));
        MemorySecrets secrets = new();
        List<OfflineSocket> sockets = [];
        await using FacetTaskNotesStore store = FacetPortableCapability.Store(
            Path.Combine(root, "state"),
            secrets,
            http,
            () =>
            {
                OfflineSocket socket = new();
                sockets.Add(socket);
                return socket;
            }
        );
        Dispatcher dispatcher = new(false);
        using FacetSettingsViewModel settings = new(store, store, dispatcher);
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        await settings.SignInAsync(
            "fixture@example.invalid",
            "synthetic",
            "",
            TestContext.CancellationToken
        );
        Assert.Contains("one-time code", settings.Status!);
        await settings.SignInAsync(
            "fixture@example.invalid",
            "synthetic",
            "synthetic",
            TestContext.CancellationToken
        );
        Assert.Contains("rejected", settings.Status!);
        await settings.SignInAsync(
            "fixture@example.invalid",
            "synthetic",
            "synthetic",
            TestContext.CancellationToken
        );
        Assert.HasCount(1, settings.Vaults);
        await settings.AddRemoteAsync(
            settings.Vaults[0],
            null,
            true,
            TestContext.CancellationToken
        );
        string first = store.SelectedProfileId!;
        await store.AddAsync(
            "Retained offline",
            TaskListQuery.Today,
            TestContext.CancellationToken
        );
        string taskId = store.State.AllTasks.Single().Id;
        await settings.AddRemoteAsync(
            settings.Vaults[0],
            null,
            true,
            TestContext.CancellationToken
        );
        Assert.HasCount(2, store.Profiles);
        await settings.SelectAsync(first, TestContext.CancellationToken);
        Assert.AreEqual(taskId, store.State.AllTasks.Single().Id);
        Assert.AreEqual(1U, store.State.PendingCount);
        Assert.IsTrue(dispatcher.Enqueues > 0);
        await settings.SignOutAsync(TestContext.CancellationToken);
        Assert.IsTrue(sockets.All(socket => socket.Disposed));
        Assert.AreEqual(0, secrets.Count);
        Assert.IsEmpty(settings.Vaults);
        await settings.SignInAsync(
            "fixture@example.invalid",
            "synthetic",
            "synthetic",
            TestContext.CancellationToken
        );
        await settings.ReauthorizeAsync(first, null, TestContext.CancellationToken);
        Assert.AreEqual(taskId, store.State.AllTasks.Single().Id);
        Assert.AreEqual(1U, store.State.PendingCount);
        await store.RefreshAsync(TestContext.CancellationToken);
        string local = Path.Combine(root, "local");
        Directory.CreateDirectory(local);
        await settings.AddLocalAsync("Local", local, true, TestContext.CancellationToken);
        Assert.HasCount(3, settings.Profiles);
        Assert.IsEmpty(settings.Conflicts);
        settings.Dispose();
        await store.SelectProfileAsync(first, TestContext.CancellationToken);
        Assert.AreEqual(first, store.SelectedProfileId);
    }

    /// <summary>Absent configuration does not prevent the initial remote session from starting.</summary>
    [TestMethod]
    public async Task InitialRemoteConfigurationDoesNotRequireApprovingInventedDefaults()
    {
        using TemporaryDirectory temporary = new();
        using HttpClient http = new(new AccountTranscript());
        int connections = 0;
        await using FacetTaskNotesStore store = FacetPortableCapability.Store(
            Path.Combine(PhysicalPath(temporary.Path), "state"),
            new MemorySecrets(),
            http,
            () =>
            {
                connections++;
                return new OfflineSocket();
            }
        );
        await store.InitializeAsync(null, null, TestContext.CancellationToken);
        await store.SignInAsync(
            "fixture@example.invalid",
            "synthetic",
            "",
            TestContext.CancellationToken
        );
        var vaults = await store.ListVaultsAsync(TestContext.CancellationToken);
        await store.AddRemoteProfileAsync(vaults[0], null, false, TestContext.CancellationToken);
        Assert.AreEqual(1, connections);
        Assert.IsFalse(store.Profiles.Single().ApproveStandard);
        Assert.IsNotNull(store.State.UserFacingError);
        Assert.IsEmpty(store.State.AllTasks);
    }

    private static string PhysicalPath(string path) =>
        OperatingSystem.IsMacOS() && path.StartsWith("/var/", StringComparison.Ordinal)
            ? "/private" + path
            : path;

    private sealed class MemorySecrets : IFacetSecretStore
    {
        private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);
        internal int Count => _values.Count;
        internal bool RejectVaultRemoval { get; set; }

        public string? Read(string identity) => _values.GetValueOrDefault(identity);

        public void Save(string identity, string value) => _values[identity] = value;

        public void Remove(string identity)
        {
            if (
                RejectVaultRemoval
                && identity.StartsWith("obsidian/vault-key/", StringComparison.Ordinal)
            )
                throw new IOException("Synthetic profile-only credential removal failure.");
            _values.Remove(identity);
        }
    }

    private sealed class AccountTranscript(bool mfa = false) : HttpMessageHandler
    {
        private int _signIns;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        )
        {
            cancellationToken.ThrowIfCancellationRequested();
            string body = "{}";
            if (request.Method == HttpMethod.Post)
                body = request.RequestUri!.AbsolutePath switch
                {
                    "/user/signin" => mfa && _signIns++ < 2
                        ? _signIns == 1
                            ? "{\"error\":\"Please enter 2FA code\"}"
                            : "{\"error\":\"2FA code is incorrect\"}"
                        : "{\"token\":\"synthetic-account-token\",\"name\":\"Fixture\",\"email\":\"fixture@example.invalid\"}",
                    "/vault/list" =>
                        "{\"vaults\":[],\"shared\":[{\"id\":\"fixture-vault\",\"name\":\"Fixture\",\"host\":\"sync-test.obsidian.md\",\"region\":\"test\",\"salt\":\"public-salt\",\"encryption_version\":3,\"password\":\"public-managed-password\"}]}",
                    "/vault/access" or "/user/signout" => "{}",
                    _ => throw new InvalidOperationException(
                        "The native account requested an unexpected transcript operation."
                    ),
                };
            return Task.FromResult(
                new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) }
            );
        }
    }

    private sealed class OfflineSocket : IFacetSocket
    {
        internal bool Disposed { get; private set; }

        public Task ConnectAsync(Uri uri, CancellationToken cancellationToken) =>
            Task.FromException(new WebSocketException("Synthetic offline transport."));

        public ValueTask SendAsync(
            ReadOnlyMemory<byte> bytes,
            WebSocketMessageType type,
            CancellationToken cancellationToken
        ) => throw new InvalidOperationException("An offline transport cannot send.");

        public ValueTask<ValueWebSocketReceiveResult> ReceiveAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken
        ) => throw new InvalidOperationException("An offline transport cannot receive.");

        public void Abort() { }

        public void Dispose() => Disposed = true;
    }

    private sealed class Dispatcher(bool access) : IUiDispatcher
    {
        internal int Enqueues { get; private set; }
        public bool HasThreadAccess => access;

        public void Enqueue(Action action)
        {
            Enqueues++;
            action();
        }
    }

    /// <summary>Framework cancellation and diagnostics.</summary>
    public required TestContext TestContext { get; set; }
}
