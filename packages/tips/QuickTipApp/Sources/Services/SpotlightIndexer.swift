import CoreSpotlight
import os
import UniformTypeIdentifiers

/// Indexes all tips into Core Spotlight for system-wide search.
@MainActor
enum SpotlightIndexer {
    // MARK: Internal

    static func indexAllTips(_ tips: [FlatTip]) {
        let items = tips.map { tip in
            let attributes = CSSearchableItemAttributeSet(contentType: .text)
            attributes.title = "\(tip.appName) — \(tip.category)"
            attributes.contentDescription = tip.formattedText
            var keywords = [tip.appName, tip.category]
            if let shortcut = tip.shortcut {
                keywords.append(shortcut)
            }
            attributes.keywords = keywords

            return CSSearchableItem(
                uniqueIdentifier: tip.id,
                domainIdentifier: self.domainIdentifier,
                attributeSet: attributes
            )
        }

        Task {
            do {
                try await CSSearchableIndex.default().indexSearchableItems(items)
                Logger.lifecycle.info("Indexed \(items.count) tips in Spotlight")
            } catch {
                Logger.lifecycle.error("Failed to index tips in Spotlight: \(error.localizedDescription)")
            }
        }
    }

    static func removeAllItems() {
        Task {
            do {
                try await CSSearchableIndex.default().deleteSearchableItems(
                    withDomainIdentifiers: [self.domainIdentifier]
                )
                Logger.lifecycle.info("Removed all Spotlight items")
            } catch {
                Logger.lifecycle.error("Failed to remove Spotlight items: \(error.localizedDescription)")
            }
        }
    }

    // MARK: Private

    private static let domainIdentifier = "com.jerred.QuickTipApp.tips"
}
