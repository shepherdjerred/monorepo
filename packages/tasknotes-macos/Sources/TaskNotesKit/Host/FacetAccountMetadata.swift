import Foundation

/// Native nonsecret capability ownership and crash-safe key cleanup intents.
internal struct FacetAccountMetadata: Codable {
    let schemaVersion: UInt32
    let activeOwner: String?
    let identities: [String: FacetSyncIdentity]
    let pendingKeyRemoval: Set<String>

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, activeOwner, identities, pendingKeyRemoval
    }

    init(
        schemaVersion: UInt32, activeOwner: String?, identities: [String: FacetSyncIdentity],
        pendingKeyRemoval: Set<String>
    ) {
        self.schemaVersion = schemaVersion
        self.activeOwner = activeOwner
        self.identities = identities
        self.pendingKeyRemoval = pendingKeyRemoval
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try values.decode(UInt32.self, forKey: .schemaVersion)
        activeOwner = try values.decodeIfPresent(String.self, forKey: .activeOwner)
        identities = try values.decode([String: FacetSyncIdentity].self, forKey: .identities)
        // Original v1 records predate this durable cleanup queue. Present
        // null/wrong-type queues remain errors, rather than lost cleanup.
        pendingKeyRemoval =
            values.contains(.pendingKeyRemoval)
            ? try values.decode(Set<String>.self, forKey: .pendingKeyRemoval) : []
    }
}
