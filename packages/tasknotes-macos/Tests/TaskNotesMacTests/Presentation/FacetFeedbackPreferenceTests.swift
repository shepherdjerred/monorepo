import CryptoKit
import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Native mobile feedback preferences") @MainActor
struct FacetFeedbackPreferenceTests {
    @Test func packagedFeedbackSoundsAreRegularFilesWithSharedPaletteBytes() throws {
        let packages = URL(filePath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let palette = try FacetJSON.parse(
            Data(
                contentsOf: packages.appending(
                    path: "tasknotes-fixtures/presentation/audio/palette.json")))
        for name in ["complete", "create", "delete", "reverse"] {
            let bundled = FacetNativeFeedback.soundURL(for: name)
            let values = try bundled.resourceValues(forKeys: [
                .isSymbolicLinkKey, .isRegularFileKey,
            ])
            #expect(values.isSymbolicLink == false)
            #expect(values.isRegularFile == true)
            let shared = packages.appending(
                path: "tasknotes-fixtures/presentation/audio/\(name).wav")
            let bytes = try Data(contentsOf: bundled)
            #expect(bytes == (try Data(contentsOf: shared)))
            let hash = SHA256.hash(data: bytes).map {
                let digits = String($0, radix: 16)
                return digits.count == 1 ? "0" + digits : digits
            }.joined()
            #expect(
                hash
                    == palette.object?.fields["cues"]?.object?.fields[name]?.object?.fields[
                        "sha256"]?.text)
        }
    }

    @Test func defaultAndExplicitQuietPreferenceAreDistinct() throws {
        let suite = "FacetFeedbackTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        #expect(FacetNativeFeedback(defaults: defaults).sounds)
        let feedback = FacetNativeFeedback(defaults: defaults)
        feedback.setSounds(false)
        feedback.setHaptics(true)
        #expect(!FacetNativeFeedback(defaults: defaults).sounds)
        #expect(FacetNativeFeedback(defaults: defaults).haptics)
        feedback.setSounds(true)
        feedback.setHaptics(false)
        #expect(FacetNativeFeedback(defaults: defaults).sounds)
        #expect(!FacetNativeFeedback(defaults: defaults).haptics)
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
            #expect(!feedback.sounds && !feedback.haptics && feedback.error != nil)
            feedback.reset()
            #expect(feedback.sounds && feedback.error == nil)
        }
    }

    @Test func legacyCombinedChoiceMigratesWithoutEnablingEitherQuietChannel() throws {
        let suite = "FacetFeedbackMigration-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        for enabled in [false, true] {
            defaults.set(Data("{\"enabled\":\(enabled)}".utf8), forKey: "Facet.feedback.preference")
            let migrated = FacetNativeFeedback(defaults: defaults)
            #expect(migrated.sounds == enabled && migrated.haptics == enabled)
            let persisted = try #require(defaults.data(forKey: "Facet.feedback.preference"))
            let preference = try FacetFeedbackPreference.decode(persisted)
            #expect(
                preference.schemaVersion == 2 && preference.sounds == enabled
                    && preference.haptics == enabled)
        }
    }
}
