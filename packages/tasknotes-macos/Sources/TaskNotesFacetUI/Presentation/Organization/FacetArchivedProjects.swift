import SwiftUI
import TaskNotesKit

internal struct FacetArchivedProjects: View {
    let store: FacetStore

    var body: some View {
        if !store.archivedProjects.isEmpty {
            DisclosureGroup("Archived Projects") {
                ForEach(store.archivedProjects) { project in
                    HStack {
                        Text(project.name)
                        Spacer()
                        Button("Restore") { store.archive(project, archived: false) }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Restore \(project.name)")
                    }
                }
            }
        }
    }
}
