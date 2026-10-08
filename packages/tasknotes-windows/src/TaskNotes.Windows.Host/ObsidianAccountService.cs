using System.Security.Cryptography;
using Core = uniffi.TaskNotesCore;

namespace TaskNotes.Windows.Host;

internal sealed class FacetAuthorizationRequiredException(string message)
    : InvalidOperationException(message);

/// <summary>Platform secure storage; values never enter settings or diagnostics.</summary>
public interface IFacetSecretStore
{
    /// <summary>Read one secure value, or absence.</summary>
    string? Read(string identity);

    /// <summary>Save one secure value.</summary>
    void Save(string identity, string value);

    /// <summary>Remove a value even when remote sign-out is unavailable.</summary>
    void Remove(string identity);
}

/// <summary>Vault discovery metadata without managed passwords or encryption keys.</summary>
public sealed record ObsidianVaultChoice(
    string Id,
    string Name,
    string Host,
    string Region,
    string Salt,
    byte EncryptionVersion,
    bool Managed,
    bool Shared
);

/// <summary>Expected sign-in outcome.</summary>
public enum ObsidianSignInOutcome
{
    /// <summary>Secure account token was stored successfully.</summary>
    SignedIn,

    /// <summary>Request a one-time code and repeat sign-in.</summary>
    MfaRequired,

    /// <summary>The submitted one-time code was rejected.</summary>
    MfaRejected,
}

/// <summary>Background Rust account facade and native HTTP execution.</summary>
public sealed class ObsidianAccountService : IAsyncDisposable
{
    internal const string TokenIdentity = "obsidian/account-token";
    internal const string OwnerIdentity = "obsidian/account-owner";
    private readonly EngineRunner _runner = new();
    private readonly IFacetSecretStore _secrets;
    private readonly HttpClient _http;
    private readonly bool _ownsHttp;
    private readonly object _credentialGate = new();
    private Core.FfiObsidianAccount? _account;
    private long _epoch;

    /// <summary>Create a transient account boundary using platform secure storage.</summary>
    public ObsidianAccountService(IFacetSecretStore secrets)
        : this(secrets, new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false }))
    {
        _ownsHttp = true;
    }

    internal ObsidianAccountService(IFacetSecretStore secrets, HttpClient http)
    {
        _secrets = secrets;
        _http = http;
    }

    /// <summary>Sign in, handling MFA without retaining passwords.</summary>
    public async Task<ObsidianSignInOutcome> SignInAsync(
        string email,
        string password,
        string mfa,
        CancellationToken cancellationToken = default
    )
    {
        long epoch;
        lock (_credentialGate)
            epoch = Interlocked.Increment(ref _epoch);
        var request = await _runner
            .RunAsync(() => Account.SignIn(email, password, mfa), cancellationToken)
            .ConfigureAwait(false);
        var response = await SendAsync(request, cancellationToken).ConfigureAwait(false);
        lock (_credentialGate)
        {
            if (Volatile.Read(ref _epoch) != epoch)
                throw new OperationCanceledException("The account changed.");
            switch (response)
            {
                case Core.ObsidianAccountResponse.SignedIn signedIn:
                    _secrets.Remove(TokenIdentity);
                    _secrets.Remove(OwnerIdentity);
                    try
                    {
                        _secrets.Save(TokenIdentity, signedIn.Token);
                        _secrets.Save(OwnerIdentity, Guid.NewGuid().ToString("N"));
                    }
                    catch
                    {
                        _secrets.Remove(TokenIdentity);
                        _secrets.Remove(OwnerIdentity);
                        throw;
                    }
                    return ObsidianSignInOutcome.SignedIn;
                case Core.ObsidianAccountResponse.MfaRequired:
                    return ObsidianSignInOutcome.MfaRequired;
                case Core.ObsidianAccountResponse.MfaRejected:
                    return ObsidianSignInOutcome.MfaRejected;
                default:
                    throw new InvalidDataException("Unexpected account response.");
            }
        }
    }

    /// <summary>Discover owned and shared vaults for the secure account.</summary>
    public async Task<IReadOnlyList<ObsidianVaultChoice>> ListVaultsAsync(
        CancellationToken cancellationToken = default
    )
    {
        long epoch = Volatile.Read(ref _epoch);
        string token = Token();
        var request = await _runner
            .RunAsync(() => Account.ListVaults(token), cancellationToken)
            .ConfigureAwait(false);
        var response = await SendAsync(request, cancellationToken).ConfigureAwait(false);
        if (Volatile.Read(ref _epoch) != epoch)
            throw new OperationCanceledException("The account changed.");
        if (response is not Core.ObsidianAccountResponse.Vaults vaults)
            throw new InvalidDataException("Unexpected vault discovery response.");
        return vaults
            .VaultsValue.Select(v => new ObsidianVaultChoice(
                v.Id,
                v.Name,
                v.Host,
                v.Region,
                v.Salt,
                v.EncryptionVersion,
                v.Managed,
                v.Shared
            ))
            .ToArray();
    }

    /// <summary>Validate a derived key before storing it in the platform locker.</summary>
    public async Task AuthorizeVaultAsync(
        string profileId,
        string vaultId,
        string? password,
        CancellationToken cancellationToken = default
    )
    {
        long epoch = Volatile.Read(ref _epoch);
        string token = Token();
        var prepared = await _runner
            .RunAsync(() => Account.PrepareVault(vaultId, password), cancellationToken)
            .ConfigureAwait(false);
        try
        {
            var request = await _runner
                .RunAsync(
                    () => Account.VaultAccess(token, vaultId, prepared.KeyBytes),
                    cancellationToken
                )
                .ConfigureAwait(false);
            var response = await SendAsync(request, cancellationToken).ConfigureAwait(false);
            lock (_credentialGate)
            {
                if (Volatile.Read(ref _epoch) != epoch)
                    throw new OperationCanceledException("The account changed.");
                if (response is not Core.ObsidianAccountResponse.AccessGranted)
                    throw new InvalidDataException("Unexpected vault authorization response.");
                _secrets.Save(
                    KeyIdentity(Owner(), profileId, vaultId),
                    Convert.ToBase64String(prepared.KeyBytes)
                );
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(prepared.KeyBytes);
        }
    }

    /// <summary>Clear local secure state, then attempt remote logout.</summary>
    public async Task SignOutAsync(
        IEnumerable<string> profileIds,
        CancellationToken cancellationToken = default
    )
    {
        string? token;
        lock (_credentialGate)
        {
            _ = Interlocked.Increment(ref _epoch);
            token = _secrets.Read(TokenIdentity);
            string? owner = _secrets.Read(OwnerIdentity);
            _secrets.Remove(TokenIdentity);
            _secrets.Remove(OwnerIdentity);
            foreach (string profile in profileIds)
                _secrets.Remove("obsidian/vault-key/" + profile);
            // Owner-qualified vault keys become inaccessible as soon as the owner is
            // removed; the coordinator removes its exact registered identities.
            _ = owner;
        }
        if (token is null)
            return;
        var request = await _runner
            .RunAsync(() => Account.SignOut(token), cancellationToken)
            .ConfigureAwait(false);
        _ = await SendAsync(request, cancellationToken).ConfigureAwait(false);
    }

    internal static string KeyIdentity(string owner, string profileId, string vaultId) =>
        "obsidian/vault-key/" + owner + "/" + profileId + "/" + vaultId;

    /// <summary>The secure authorization generation; account changes require vault reauthorization.</summary>
    public string AccountOwner
    {
        get
        {
            lock (_credentialGate)
                return Owner();
        }
    }

    internal (string Token, byte[] Key) SessionCredentials(
        string owner,
        string profileId,
        string vaultId
    )
    {
        lock (_credentialGate)
        {
            if (!StringComparer.Ordinal.Equals(owner, Owner()))
                throw new FacetAuthorizationRequiredException(
                    "Authorize this vault with the signed-in account again."
                );
            string encoded =
                _secrets.Read(KeyIdentity(owner, profileId, vaultId))
                ?? throw new FacetAuthorizationRequiredException("Authorize this vault again.");
            byte[] key = Convert.FromBase64String(encoded);
            if (key.Length != 32)
            {
                CryptographicOperations.ZeroMemory(key);
                throw new InvalidDataException("The secure vault key is invalid.");
            }
            return (Token(), key);
        }
    }

    internal void ForgetVault(string owner, string profileId, string vaultId)
    {
        lock (_credentialGate)
            _secrets.Remove(KeyIdentity(owner, profileId, vaultId));
    }

    private string Owner() =>
        _secrets.Read(OwnerIdentity)
        ?? throw new FacetAuthorizationRequiredException("Sign in to Obsidian first.");

    private string Token()
    {
        lock (_credentialGate)
            return _secrets.Read(TokenIdentity)
                ?? throw new FacetAuthorizationRequiredException("Sign in to Obsidian first.");
    }

    private Core.FfiObsidianAccount Account => _account ??= new Core.FfiObsidianAccount();

    private async Task<Core.ObsidianAccountResponse> SendAsync(
        Core.ObsidianHttpRequest request,
        CancellationToken cancellationToken
    )
    {
        bool consumed = false;
        try
        {
            if (request.Preflight)
            {
                using var preflight = new HttpRequestMessage(HttpMethod.Options, request.Url);
                preflight.Headers.Add("Origin", "https://obsidian.md");
                preflight.Headers.Add("Access-Control-Request-Method", "POST");
                preflight.Headers.Add("Access-Control-Request-Headers", "content-type");
                using var preflightResponse = await _http
                    .SendAsync(preflight, cancellationToken)
                    .ConfigureAwait(false);
                preflightResponse.EnsureSuccessStatusCode();
            }
            using var message = new HttpRequestMessage(HttpMethod.Post, request.Url);
            message.Content = new StringContent(
                request.Body,
                System.Text.Encoding.UTF8,
                "application/json"
            );
            foreach (var header in request.Headers)
            {
                if (header.Name.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))
                    continue;
                message.Headers.Add(header.Name, header.Value);
            }
            using var response = await _http
                .SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken)
                .ConfigureAwait(false);
            await using var stream = await response
                .Content.ReadAsStreamAsync(cancellationToken)
                .ConfigureAwait(false);
            using var body = new MemoryStream();
            byte[] buffer = new byte[16384];
            int count;
            while (
                (count = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false))
                > 0
            )
            {
                if (body.Length + count > 4 * 1024 * 1024)
                    throw new InvalidDataException("The account response exceeded its limit.");
                await body.WriteAsync(buffer.AsMemory(0, count), cancellationToken)
                    .ConfigureAwait(false);
            }
            string json = System.Text.Encoding.UTF8.GetString(
                body.GetBuffer(),
                0,
                checked((int)body.Length)
            );
            cancellationToken.ThrowIfCancellationRequested();
            return await _runner
                .RunAsync(
                    () =>
                    {
                        // Response consumes the request before parsing or returning a typed
                        // authentication failure. Preserve that failure instead of cancelling
                        // a now-absent request and replacing it with NotFound.
                        consumed = true;
                        return Account.Response(
                            request.RequestId,
                            checked((ushort)response.StatusCode),
                            json
                        );
                    },
                    CancellationToken.None
                )
                .ConfigureAwait(false);
        }
        catch
        {
            if (!consumed)
                await _runner
                    .RunAsync(
                        () =>
                        {
                            Account.CancelRequest(request.RequestId);
                            return true;
                        },
                        CancellationToken.None
                    )
                    .ConfigureAwait(false);
            throw;
        }
    }

    /// <summary>Drain callbacks and release the Rust account handle.</summary>
    public async ValueTask DisposeAsync()
    {
        _ = Interlocked.Increment(ref _epoch);
        await _runner
            .RunAsync(() =>
            {
                _account?.Dispose();
                _account = null;
                return true;
            })
            .ConfigureAwait(false);
        await _runner.DisposeAsync().ConfigureAwait(false);
        if (_ownsHttp)
            _http.Dispose();
    }
}
