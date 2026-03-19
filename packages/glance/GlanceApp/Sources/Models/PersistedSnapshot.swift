import Foundation
import GRDB

// MARK: - PersistedSnapshot

/// A flattened, persistable representation of a service snapshot for historical storage.
struct PersistedSnapshot: Codable, FetchableRecord, PersistableRecord {
    // MARK: Lifecycle

    /// Create a persisted snapshot from a live service snapshot.
    init(from snapshot: ServiceSnapshot) {
        self.id = nil
        self.providerId = snapshot.id
        self.status = snapshot.status.rawValue
        self.summary = snapshot.summary
        self.error = snapshot.error
        self.timestamp = snapshot.timestamp.timeIntervalSince1970
    }

    // MARK: Internal

    static let databaseTableName = "snapshots"

    /// Auto-incremented primary key.
    var id: Int64?
    /// Provider identifier (e.g., "kubernetes", "argocd").
    var providerId: String
    /// Raw integer value of `ServiceStatus`.
    var status: Int
    /// Human-readable summary line.
    var summary: String
    /// Error message, if any.
    var error: String?
    /// Unix timestamp of the snapshot.
    var timestamp: TimeInterval

    /// Convert the raw status integer back to a `ServiceStatus`.
    var serviceStatus: ServiceStatus {
        ServiceStatus(rawValue: self.status) ?? .unknown
    }

    /// Convert back to a `Date`.
    var date: Date {
        Date(timeIntervalSince1970: self.timestamp)
    }
}
