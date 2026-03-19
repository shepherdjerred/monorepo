@preconcurrency import CoreSpotlight
import Foundation
import OSLog
import UniformTypeIdentifiers

// MARK: - SpotlightIndexer

/// Indexes service provider statuses in Core Spotlight for search.
///
/// After each refresh cycle, updates the searchable index so users
/// can find services via Spotlight and open the dashboard.
final class SpotlightIndexer: Sendable {
    // MARK: Lifecycle

    init() {}

    // MARK: Internal

    /// Content type for Glance service items.
    static let domainIdentifier = "com.shepherdjerred.glance.service"

    /// Activity type used for Spotlight continuation.
    static let activityType = "com.shepherdjerred.glance.viewService"

    /// Create an `NSUserActivity` for a service so Spotlight can continue to the app.
    @MainActor
    static func userActivity(for serviceId: String, displayName: String) -> NSUserActivity {
        let activity = NSUserActivity(activityType: activityType)
        activity.title = displayName
        activity.userInfo = ["serviceId": serviceId]
        activity.isEligibleForSearch = true
        return activity
    }

    /// Extract the service ID from an `NSUserActivity` for Spotlight continuation.
    static func serviceId(from activity: NSUserActivity) -> String? {
        guard activity.activityType == self.activityType else {
            return nil
        }
        return activity.userInfo?["serviceId"] as? String
    }

    /// Update the Spotlight index with current snapshots.
    func updateIndex(with snapshots: [ServiceSnapshot]) {
        let items = snapshots.map { Self.searchableItem(from: $0) }

        Task.detached {
            do {
                try await self.searchableIndex.deleteSearchableItems(
                    withDomainIdentifiers: [SpotlightIndexer.domainIdentifier],
                )
                try await self.searchableIndex.indexSearchableItems(items)
                GlanceLogger.ui.debug("Spotlight indexed \(items.count) services")
            } catch {
                GlanceLogger.ui.error(
                    "Spotlight index failed: \(error.localizedDescription, privacy: .public)",
                )
            }
        }
    }

    /// Remove all Glance items from Spotlight.
    func removeAllFromIndex() {
        Task.detached {
            do {
                try await self.searchableIndex.deleteSearchableItems(
                    withDomainIdentifiers: [SpotlightIndexer.domainIdentifier],
                )
            } catch {
                GlanceLogger.ui.error(
                    "Spotlight cleanup failed: \(error.localizedDescription, privacy: .public)",
                )
            }
        }
    }

    // MARK: Private

    // swiftlint:disable:next modifier_order
    private nonisolated(unsafe) let searchableIndex = CSSearchableIndex.default()

    private static func searchableItem(from snapshot: ServiceSnapshot) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: .content)
        attributes.title = snapshot.displayName
        attributes.contentDescription = "\(snapshot.status.label): \(snapshot.summary)"
        attributes.keywords = [
            "glance",
            "homelab",
            snapshot.displayName.lowercased(),
            snapshot.status.label.lowercased(),
        ]

        return CSSearchableItem(
            uniqueIdentifier: "\(self.domainIdentifier).\(snapshot.id)",
            domainIdentifier: self.domainIdentifier,
            attributeSet: attributes,
        )
    }
}
