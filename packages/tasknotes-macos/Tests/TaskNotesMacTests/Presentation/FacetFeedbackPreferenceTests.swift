import Foundation
import Testing

@testable import TaskNotesFacetUI

@Suite("Native mobile feedback preferences") @MainActor
struct FacetFeedbackPreferenceTests {
    @Test func packagedFeedbackSoundsAreRegularFilesWithRetainedBytes() throws {
        let packages = URL(filePath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        for name in ["complete", "create", "delete"] {
            let bundled = FacetNativeFeedback.soundURL(for: name)
            let values = try bundled.resourceValues(forKeys: [
                .isSymbolicLinkKey, .isRegularFileKey,
            ])
            #expect(values.isSymbolicLink == false)
            #expect(values.isRegularFile == true)
            let retained = packages.appending(
                path: "tasks-for-obsidian/src/assets/sounds/\(name).wav")
            #expect(try Data(contentsOf: bundled) == Data(contentsOf: retained))
        }
    }

    @Test func defaultAndExplicitQuietPreferenceAreDistinct() throws {
        let suite = "FacetFeedbackTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        #expect(FacetNativeFeedback(defaults: defaults).enabled)
        let feedback = FacetNativeFeedback(defaults: defaults)
        feedback.setEnabled(false)
        #expect(!FacetNativeFeedback(defaults: defaults).enabled)
        feedback.setEnabled(true)
        #expect(FacetNativeFeedback(defaults: defaults).enabled)
    }

    @Test func malformedOrUnknownSettingsRequireExplicitRecovery() throws {
        let suite = "FacetFeedbackTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        for value in [
            "not JSON", "{\"enabled\":true,\"unknown\":1}", "{\"enabled\":\"yes\"}",
            "{\"enabled\":true,\"enabled\":false}",
        ] {
            defaults.set(Data(value.utf8), forKey: "Facet.feedback.preference")
            let feedback = FacetNativeFeedback(defaults: defaults)
            #expect(!feedback.enabled && feedback.error != nil)
            feedback.setEnabled(true)
            #expect(feedback.enabled && feedback.error == nil)
        }
    }
}
