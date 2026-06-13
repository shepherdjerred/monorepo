import SwiftUI

// MARK: - WhatsNewView

/// Shows release notes after an app update.
struct WhatsNewView: View {
    // MARK: Internal

    /// Whether the What's New sheet should be shown (version changed since last seen).
    static var shouldShow: Bool {
        guard let current = currentVersion else {
            return false
        }
        let lastSeen = UserDefaults.standard.string(forKey: Self.lastSeenVersionKey)
        return lastSeen != current
    }

    @Environment(\.dismiss) var dismiss

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    self.header
                    self.featureList
                }
                .padding(32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()

            HStack {
                Spacer()
                Button(String(localized: "Continue")) {
                    Self.markCurrentVersionSeen()
                    self.dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }
            .padding()
        }
        .frame(width: 460, height: 380)
    }

    // MARK: Private

    private static let lastSeenVersionKey = "lastSeenAppVersion"

    private static var currentVersion: String? {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("What's New in Glance")
                .font(.largeTitle.bold())

            if let version = Self.currentVersion {
                Text("Version \(version)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var featureList: some View {
        VStack(alignment: .leading, spacing: 12) {
            self.featureRow(
                icon: "accessibility",
                title: String(localized: "Improved Accessibility"),
                description: String(
                    localized: "VoiceOver labels, hints, and reduced motion support throughout the app.",
                ),
            )
            self.featureRow(
                icon: "hand.wave.fill",
                title: String(localized: "Onboarding"),
                description: String(localized: "A guided setup experience for new users with prerequisite checks."),
            )
            self.featureRow(
                icon: "globe",
                title: String(localized: "Localization Ready"),
                description: String(localized: "User-facing strings prepared for future localization."),
            )
        }
    }

    private func featureRow(icon: String, title: String, description: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .accessibilityHidden(true)
                .font(.title2)
                .foregroundStyle(.tint)
                .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                Text(description)
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private static func markCurrentVersionSeen() {
        guard let current = currentVersion else {
            return
        }
        UserDefaults.standard.set(current, forKey: Self.lastSeenVersionKey)
    }
}

#if DEBUG
    #Preview("What's New") {
        WhatsNewView()
    }
#endif
