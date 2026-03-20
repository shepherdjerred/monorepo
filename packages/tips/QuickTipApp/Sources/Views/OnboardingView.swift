import SwiftUI

/// Welcome window shown on first launch to introduce the app.
struct OnboardingView: View {
    // MARK: Internal

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "lightbulb.fill")
                .font(.system(size: 48))
                .foregroundStyle(.yellow)

            Text("Welcome to QuickTip")
                .font(.largeTitle.bold())

            Text("Get a daily tip for your favorite Mac apps.\nLook for the lightbulb in your menu bar.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 12) {
                self.featureRow(icon: "calendar", text: "A new tip every day")
                self.featureRow(icon: "magnifyingglass", text: "Search tips across dozens of apps")
                self.featureRow(icon: "star", text: "Favorite tips to save them")
                self.featureRow(icon: "bell", text: "Optional daily notification")
            }
            .padding()

            Button("Get Started") {
                self.hasCompleted = true
                self.dismiss()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .padding(40)
        .frame(width: 400)
    }

    // MARK: Private

    @AppStorage("hasCompletedOnboarding") private var hasCompleted = false
    @Environment(\.dismiss) private var dismiss

    private func featureRow(icon: String, text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(.tint)
                .frame(width: 24)
            Text(text)
        }
    }
}
