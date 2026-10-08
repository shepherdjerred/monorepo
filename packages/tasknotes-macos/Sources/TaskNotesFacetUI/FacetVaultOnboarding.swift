import SwiftUI

internal struct FacetVaultOnboarding: View {
    @Bindable var store: FacetStore
    @Binding var importsFolder: Bool
    let folderAction: String

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "folder.badge.plus").font(.largeTitle).accessibilityHidden(true)
            Text("Your tasks, in your vault").font(.title2.bold())
            Text("Use an existing vault to get started. Facet keeps your notes in Markdown.")
                .multilineTextAlignment(.center)
            Toggle(
                "Use TaskNotes defaults if this vault has no settings", isOn: $store.approveStandard
            )
            Button(folderAction) { importsFolder = true }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("facet.onboarding.local")
            Button("Connect Obsidian Sync…") { store.showsAccount = true }
                .accessibilityIdentifier("facet.onboarding.sync")
            if store.isLoading { ProgressView() }
        }.padding(32).frame(maxWidth: 480, maxHeight: .infinity)
    }
}
