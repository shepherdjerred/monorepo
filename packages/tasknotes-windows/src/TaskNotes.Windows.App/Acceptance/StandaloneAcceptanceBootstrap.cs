using System.Security.Cryptography;
using System.Text.Json;
using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.App.Acceptance;

/// <summary>Seeds only a descriptor-bound app-private replica in the isolated E2E build.</summary>
internal sealed class StandaloneAcceptanceBootstrap
{
    private readonly string _descriptorPath;
    private readonly string _schema;
    private readonly string _descriptorHash;

    internal StandaloneAcceptanceBootstrap(
        string descriptorPath,
        string localStateDirectory,
        string packageFamilyName,
        string schema
    )
    {
        Descriptor = StandaloneAcceptanceDescriptor.Read(
            descriptorPath,
            localStateDirectory,
            packageFamilyName,
            schema
        );
        _descriptorPath = descriptorPath;
        _schema = schema;
        _descriptorHash = Convert.ToHexStringLower(
            SHA256.HashData(File.ReadAllBytes(descriptorPath))
        );
    }

    internal StandaloneAcceptanceDescriptor Descriptor { get; }

    internal void Prepare()
    {
        StandaloneAcceptanceDescriptor.RequireUnlinkedPath(_descriptorPath);
        if (
            _descriptorHash
            != Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(_descriptorPath)))
        )
            throw new InvalidDataException(
                "The acceptance descriptor changed before registration."
            );
        Directory.CreateDirectory(Descriptor.EngineDirectory);
        StandaloneAcceptanceDescriptor.RequireUnlinkedPath(Descriptor.EngineDirectory);
        string receiptPath = Path.Combine(Descriptor.EngineDirectory, "bootstrap-receipt.json");
        string catalogPath = Path.Combine(Descriptor.EngineDirectory, "profiles.json");
        if (File.Exists(catalogPath))
            StandaloneAcceptanceDescriptor.RequireUnlinkedPath(catalogPath);
        if (File.Exists(receiptPath))
        {
            StandaloneAcceptanceDescriptor.RequireUnlinkedPath(receiptPath);
            using FileStream existingReceipt = new(
                receiptPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read
            );
            if (existingReceipt.Length is <= 0 or > 4096)
                throw new InvalidDataException(
                    "The acceptance bootstrap receipt has an invalid size."
                );
            using StreamReader receiptReader = new(existingReceipt);
            string json = receiptReader.ReadToEnd();
            new FacetSchema(_schema).Validate(json, "bootstrapReceipt");
            using var receipt = JsonDocument.Parse(json);
            if (
                receipt.RootElement.GetProperty("runId").GetString() != Descriptor.RunId
                || receipt.RootElement.GetProperty("profileId").GetString() != Descriptor.ProfileId
                || receipt.RootElement.GetProperty("descriptorSha256").GetString()
                    != _descriptorHash
                || !File.Exists(catalogPath)
            )
                throw new InvalidDataException("The acceptance bootstrap receipt lost its owner.");
            RequireProfile(new FacetProfileCatalog(Descriptor.EngineDirectory));
            return;
        }
        Descriptor.VerifySeedBytes();
        var catalog = new FacetProfileCatalog(Descriptor.EngineDirectory);
        if (catalog.Profiles.Count == 0)
            catalog.Add(ExpectedProfile());
        RequireProfile(catalog);
        var content = JsonSerializer.SerializeToUtf8Bytes(
            new
            {
                schemaVersion = 1,
                runId = Descriptor.RunId,
                profileId = Descriptor.ProfileId,
                descriptorSha256 = _descriptorHash,
            }
        );
        using FileStream receiptStream = new(
            receiptPath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None
        );
        receiptStream.Write(content);
        receiptStream.Flush(true);
    }

    private FacetProfileRegistration ExpectedProfile() =>
        new(
            Descriptor.ProfileId,
            "Synthetic native acceptance",
            Descriptor.VaultDirectory,
            true,
            false,
            null,
            null
        );

    private void RequireProfile(FacetProfileCatalog catalog)
    {
        if (
            catalog.Profiles.Count != 1
            || catalog.Profiles[0] != ExpectedProfile()
            || catalog.SelectedId != Descriptor.ProfileId
        )
            throw new InvalidDataException(
                "The acceptance profile does not match its private run."
            );
    }
}
