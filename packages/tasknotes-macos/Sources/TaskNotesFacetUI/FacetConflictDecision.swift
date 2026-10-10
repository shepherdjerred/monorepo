import Foundation
import TaskNotesKit

/// Once submitted, the owner, fences and bytes stay fixed until the receipt settles.
internal struct FacetConflictDecision: Sendable {
    let id: String
    let profileID: String
    let conflict: FacetConflict
    let resolution: FacetValue
    let payload: Data?
    let replacesText: Bool

    init(profileID: String, conflict: FacetConflict, resolution: FacetValue, id: String) {
        self.id = id
        self.profileID = profileID
        self.conflict = conflict
        self.resolution = resolution
        payload = nil
        replacesText = false
    }

    init(profileID: String, conflict: FacetConflict, newPath: String) {
        id = UUID().uuidString
        self.profileID = profileID
        self.conflict = conflict
        resolution = .object(["kind": .string("keep_both"), "newPath": .string(newPath)])
        payload = nil
        replacesText = false
    }

    init(profileID: String, conflict: FacetConflict, text: String) throws {
        // Count before allocating the immutable UTF-8 payload.
        guard text.utf8.count <= FacetRetainedText.maximumBytes else {
            throw FacetConflictEditorError.textTooLarge
        }
        id = UUID().uuidString
        self.profileID = profileID
        self.conflict = conflict
        resolution = .object(["kind": .string("replace_payload"), "deleted": .bool(false)])
        payload = Data(text.utf8)
        replacesText = true
    }
}

internal enum FacetConflictEditorError: Error, LocalizedError {
    case textTooLarge
    var errorDescription: String? {
        "Text editing is limited to 1 MiB of UTF-8. Keep or export either complete version instead."
    }
}

internal enum FacetConflictVersion: String { case base, local, remote }

extension FacetConflict {
    internal func metadata(version: FacetConflictVersion) -> FacetVersionMetadata? {
        switch version {
        case .base: base
        case .local: local
        case .remote: remote
        }
    }
}
