import Foundation
import Testing

@testable import TaskNotesFacetUI

@Suite("Mobile appearance preference") @MainActor
struct FacetAppearancePreferenceTests {
    @Test(arguments: FacetAppearanceChoice.allCases)
    func storedChoicesSurviveOpeningAndRelaunch(choice: FacetAppearanceChoice) throws {
        let suite = "Facet.appearance.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let fresh = FacetAppearancePreference(defaults: defaults)
        #expect(fresh.choice == .system && fresh.error == nil)
        #expect(defaults.object(forKey: FacetAppearancePreference.key) == nil)
        fresh.select(choice)
        let reopened = FacetAppearancePreference(defaults: defaults)
        #expect(reopened.choice == choice && reopened.error == nil)
        #expect(defaults.string(forKey: FacetAppearancePreference.key) == choice.rawValue)
    }

    @Test func invalidStoredChoiceRequiresExplicitReplacement() throws {
        let suite = "Facet.appearance.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set("future-unrecognized", forKey: FacetAppearancePreference.key)
        let preference = FacetAppearancePreference(defaults: defaults)
        #expect(preference.choice == nil && preference.error != nil)
        #expect(defaults.string(forKey: FacetAppearancePreference.key) == "future-unrecognized")
        preference.select(.dark)
        #expect(preference.choice == .dark && preference.error == nil)
        #expect(FacetAppearancePreference(defaults: defaults).choice == .dark)
    }

    @Test func wrongStoredTypeIsNotReadAsTheSystemDefault() throws {
        let suite = "Facet.appearance.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(["invalid"], forKey: FacetAppearancePreference.key)
        let preference = FacetAppearancePreference(defaults: defaults)
        #expect(preference.choice == nil && preference.error != nil)
        #expect(defaults.array(forKey: FacetAppearancePreference.key)?.count == 1)
    }
}
