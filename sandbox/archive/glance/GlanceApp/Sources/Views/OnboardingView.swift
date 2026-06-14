import SwiftUI

// MARK: - OnboardingView

/// Multi-step onboarding sheet shown on first launch.
struct OnboardingView: View {
    // MARK: Internal

    @Bindable var settings: GlanceSettings
    @Environment(\.dismiss) var dismiss

    var body: some View {
        VStack(spacing: 0) {
            self.stepContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(32)

            Divider()

            self.navigationBar
                .padding()
        }
        .frame(width: 500, height: 420)
    }

    // MARK: Private

    @State private var currentStep = 0
    @State private var toolAvailability: [String: Bool] = [:]

    private let totalSteps = 4

    @ViewBuilder
    private var stepContent: some View {
        switch self.currentStep {
        case 0:
            self.welcomeStep
        case 1:
            self.prerequisitesStep
        case 2:
            self.providerSelectionStep
        default:
            self.completeStep
        }
    }

    // MARK: - Step 1: Welcome

    private var welcomeStep: some View {
        VStack(spacing: 16) {
            Image(systemName: "binoculars.fill")
                .accessibilityHidden(true)
                .font(.system(size: 64))
                .foregroundStyle(.tint)

            Text("Welcome to Glance")
                .font(.largeTitle.bold())

            Text(
                "Glance monitors your homelab infrastructure from the menu bar, "
                    + "giving you at-a-glance status of all your services.",
            )
            .font(.body)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 380)
        }
    }

    // MARK: - Step 2: Prerequisites

    private var prerequisitesStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Prerequisites")
                .font(.title2.bold())

            Text("Glance uses these CLI tools to communicate with your infrastructure.")
                .font(.body)
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 12) {
                self.toolRow(name: "op", description: "1Password CLI (API secrets)")
                self.toolRow(name: "kubectl", description: "Kubernetes CLI")
                self.toolRow(name: "talosctl", description: "Talos Linux CLI")
            }
            .padding()
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))

            Text("Missing tools will cause their providers to show as unavailable.")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .task {
            await self.checkTools()
        }
    }

    // MARK: - Step 3: Provider Selection

    private var providerSelectionStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Select Providers")
                .font(.title2.bold())

            Text("Choose which services to monitor.")
                .font(.body)
                .foregroundStyle(.secondary)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(ServiceCategory.allCases, id: \.self) { category in
                        self.categorySection(category)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: - Step 4: Complete

    private var completeStep: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.seal.fill")
                .accessibilityHidden(true)
                .font(.system(size: 64))
                .foregroundStyle(.green)

            Text("You're All Set!")
                .font(.largeTitle.bold())

            Text("Glance will now monitor your selected services from the menu bar.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)

            VStack(alignment: .leading, spacing: 8) {
                Toggle(
                    String(localized: "Enable notifications"),
                    isOn: self.$settings.notificationsEnabled,
                )

                Toggle(
                    String(localized: "Launch at login"),
                    isOn: self.$settings.launchAtLogin,
                )
            }
            .padding()
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    // MARK: - Navigation

    private var navigationBar: some View {
        HStack {
            if self.currentStep > 0 {
                Button(String(localized: "Back")) {
                    self.currentStep -= 1
                }
            }

            Spacer()

            self.stepIndicator

            Spacer()

            if self.currentStep < self.totalSteps - 1 {
                Button(String(localized: "Continue")) {
                    self.currentStep += 1
                }
                .keyboardShortcut(.defaultAction)
            } else {
                Button(String(localized: "Get Started")) {
                    self.settings.hasCompletedOnboarding = true
                    self.dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
    }

    private var stepIndicator: some View {
        HStack(spacing: 6) {
            ForEach(0 ..< self.totalSteps, id: \.self) { step in
                Circle()
                    .fill(step == self.currentStep ? Color.accentColor : Color.secondary.opacity(0.3))
                    .frame(width: 8, height: 8)
            }
        }
    }

    private func toolRow(name: String, description: String) -> some View {
        let isAvailable = self.toolAvailability[name] == true
        let iconName = isAvailable
            ? "checkmark.circle.fill" : "xmark.circle.fill"
        return HStack(spacing: 12) {
            Image(systemName: iconName)
                .accessibilityHidden(true)
                .foregroundStyle(isAvailable ? .green : .red)
                .font(.title3)

            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: name)
                    .font(.body.monospaced())
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func categorySection(_ category: ServiceCategory) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(category.displayName)
                .font(.headline)

            ForEach(Array(category.providerIds).sorted(), id: \.self) { providerId in
                Toggle(
                    providerId,
                    isOn: Binding(
                        get: { self.settings.enabledProviderIds.contains(providerId) },
                        set: { enabled in
                            if enabled {
                                self.settings.enabledProviderIds.insert(providerId)
                            } else {
                                self.settings.enabledProviderIds.remove(providerId)
                            }
                        },
                    ),
                )
                .font(.body)
            }
        }
    }

    private func checkTools() async {
        let tools = ["op", "kubectl", "talosctl"]
        for tool in tools {
            let available = await FileManager.default.isExecutableFile(
                atPath: self.resolveToolPath(tool),
            )
            self.toolAvailability[tool] = available
        }
    }

    private func resolveToolPath(_ tool: String) async -> String {
        // Check common paths
        let paths = [
            "/usr/local/bin/\(tool)",
            "/opt/homebrew/bin/\(tool)",
            "/usr/bin/\(tool)",
        ]
        for path in paths
            where FileManager.default.isExecutableFile(atPath: path)
        {
            return path
        }
        return "/usr/bin/\(tool)"
    }
}

#if DEBUG
    #Preview("Onboarding") {
        OnboardingView(settings: PreviewData.makeSettings())
    }
#endif
