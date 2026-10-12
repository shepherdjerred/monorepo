import TaskNotesUniFFI

public struct FacetRemoteVault: Codable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let host: String
    public let region: String
    public let salt: String
    public let encryptionVersion: UInt8
    public let managed: Bool
    public let shared: Bool

    internal init(_ vault: ObsidianRemoteVault) {
        id = vault.id
        name = vault.name
        host = vault.host
        region = vault.region
        salt = vault.salt
        encryptionVersion = vault.encryptionVersion
        managed = vault.managed
        shared = vault.shared
    }
}
