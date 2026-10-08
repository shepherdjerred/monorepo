public import Foundation
import TaskNotesUniFFI

public struct FacetRetainedText: Sendable {
    public static let maximumBytes: UInt64 = FacetPayloadConsumer.textLimit
    public let text: String
    public let cleanupDiagnostic: FacetFailureDiagnostic?
}

public struct FacetRetainedExport: Sendable {
    public let url: URL
    public let cleanupDiagnostic: FacetFailureDiagnostic?
}

/// A retained version is opened
/// only for explicit preview/export and never enters a JSON byte array.
extension FacetEngine {
    public func conflictText(
        profileID: String, id: String, version: String, metadata: FacetVersionMetadata
    ) async throws -> FacetRetainedText {
        let reader = try await conflictReader(
            profileID: profileID, id: id, version: version, metadata: metadata)
        let result = try await FacetPayloadConsumer.text(reader: reader, metadata: metadata)
        return FacetRetainedText(
            text: result.value, cleanupDiagnostic: result.cleanupDiagnostic)
    }

    public func exportConflict(
        profileID: String, id: String, version: String, metadata: FacetVersionMetadata
    ) async throws -> FacetRetainedExport {
        let root = try VaultDirectory(url: directory)
        _ = try root.directory("conflict-exports", create: true)
        let destination = directory.appendingPathComponent("conflict-exports")
        let reader = try await conflictReader(
            profileID: profileID, id: id, version: version, metadata: metadata)
        let result = try await FacetPayloadConsumer.export(
            reader: reader, metadata: metadata, directory: destination)
        return FacetRetainedExport(
            url: result.value, cleanupDiagnostic: result.cleanupDiagnostic)
    }

    private func conflictReader(
        profileID: String, id: String, version: String, metadata: FacetVersionMetadata
    ) async throws -> FacetPayloadReaderLease {
        guard ["base", "local", "remote"].contains(version) else {
            throw FacetContractError.unsupportedResponse
        }
        let owner = try await payloadReaders.owner(profileID: profileID)
        try requireOpen()
        guard
            let handle = try engine.conflictPayload(
                profileId: profileID, conflictId: id, version: version)
        else { throw FacetContractError.unsupportedResponse }
        let reader = try FacetBoundedPayloadReader(
            payload: handle, expected: metadata, schema: schema)
        let token = try await payloadReaders.register(reader, owner: owner)
        return FacetPayloadReaderLease(
            reader: reader, registry: payloadReaders, owner: owner, id: token)
    }
}
