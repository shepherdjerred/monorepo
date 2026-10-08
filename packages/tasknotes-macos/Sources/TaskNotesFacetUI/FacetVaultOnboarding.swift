import SwiftUI

internal struct FacetVaultOnboarding: View {
    @Bindable var store: FacetStore
    @Binding var importsFolder: Bool
    let folderAction: String

    var body: some View {
        #if os(iOS)
            GeometryReader { geometry in
                ScrollView {
                    content.padding(32).frame(maxWidth: 480)
                        .frame(maxWidth: .infinity, minHeight: geometry.size.height)
                }
            }
        #else
            content.padding(32).frame(maxWidth: 480, maxHeight: .infinity)
        #endif
    }

    private var content: some View {
        VStack(spacing: 20) {
            Image(systemName: "folder.badge.plus").font(.largeTitle).accessibilityHidden(true)
            Text("Your tasks, in your vault").font(.title2.bold())
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Text("Use an existing vault to get started. Facet keeps your notes in Markdown.")
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Toggle(isOn: $store.approveStandard) {
                Text("Use TaskNotes defaults if this vault has no settings")
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                importsFolder = true
            } label: {
                Text(folderAction).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("facet.onboarding.local")
            Button {
                store.showsAccount = true
            } label: {
                Text("Connect Obsidian Sync…").multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityIdentifier("facet.onboarding.sync")
            if store.isLoading { ProgressView() }
        }
    }
}
