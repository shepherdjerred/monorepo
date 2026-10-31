import Foundation
import Observation
import SwiftUI

internal enum FacetAppearanceChoice: String, CaseIterable {
    case system, light, dark

    var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// Device-local presentation preference. Invalid stored data stays invalid
/// until the user explicitly replaces it; reading never rewrites a choice.
@Observable @MainActor internal final class FacetAppearancePreference {
    static let shared = FacetAppearancePreference()
    static let key = "Facet.appearance.preference"
    private let defaults: UserDefaults
    private(set) var choice: FacetAppearanceChoice?
    private(set) var error: String?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        guard defaults.object(forKey: Self.key) != nil else {
            choice = .system
            return
        }
        guard let raw = defaults.string(forKey: Self.key),
            let stored = FacetAppearanceChoice(rawValue: raw)
        else {
            choice = nil
            error = "The saved appearance is invalid. Choose an appearance to replace it."
            return
        }
        choice = stored
    }

    func select(_ value: FacetAppearanceChoice) {
        defaults.set(value.rawValue, forKey: Self.key)
        choice = value
        error = nil
    }
}

internal struct FacetAppearanceScope: ViewModifier {
    private let preference = FacetAppearancePreference.shared

    func body(content: Content) -> some View {
        #if os(iOS)
            content.preferredColorScheme(preference.choice?.colorScheme)
        #else
            content
        #endif
    }
}

internal struct FacetAppearanceSettings: View {
    private let preference = FacetAppearancePreference.shared

    var body: some View {
        Picker(
            "Appearance",
            selection: Binding(
                get: { preference.choice },
                set: { if let value = $0 { preference.select(value) } })
        ) {
            if preference.choice == nil {
                Text("Choose appearance").tag(Optional<FacetAppearanceChoice>.none)
            }
            ForEach(FacetAppearanceChoice.allCases, id: \.self) { choice in
                Text(choice.title).tag(Optional(choice))
            }
        }.accessibilityIdentifier("facet.settings.appearance")
        if let error = preference.error {
            Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
        }
    }
}
