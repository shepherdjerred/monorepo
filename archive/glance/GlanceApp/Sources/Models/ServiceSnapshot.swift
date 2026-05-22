import Foundation

/// A point-in-time status report from a single service provider.
struct ServiceSnapshot: Identifiable {
    let id: String
    let displayName: String
    let iconName: String
    let status: ServiceStatus
    let summary: String
    let detail: ServiceDetail
    let error: String?
    let timestamp: Date
    var webURL: String?
}
