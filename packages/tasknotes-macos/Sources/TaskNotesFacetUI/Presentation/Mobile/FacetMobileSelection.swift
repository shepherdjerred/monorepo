#if os(iOS)
    import SwiftUI
    import TaskNotesKit

    internal struct FacetMobileSelectionBar: View {
        @Bindable var window: FacetWindowState
        let actions: () -> Void

        var body: some View {
            HStack {
                Text("\(window.selectedTaskIDs.count) selected")
                    .font(.subheadline).accessibilityIdentifier("facet.selection.count")
                Spacer()
                Button("Actions", systemImage: "ellipsis.circle", action: actions)
                    .disabled(window.selectedTaskIDs.isEmpty)
                    .accessibilityIdentifier("facet.selection.actions")
            }
            .padding(16).background(.bar)
        }
    }

    internal struct FacetMobileSelectionRow: View {
        let task: FacetTask
        let presentation: FacetTaskPresentation
        let selected: Bool
        let toggle: () -> Void

        var body: some View {
            Button(action: toggle) {
                HStack(spacing: 12) {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(.title2).foregroundStyle(FacetNativeStyle.brand)
                        .frame(minWidth: 44, minHeight: 44)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(task.title).foregroundStyle(.primary).multilineTextAlignment(.leading)
                        if !presentation.metadata.isEmpty {
                            Text(presentation.metadata).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                }.padding(.vertical, 8).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(task.title)
            .accessibilityValue(selected ? "Selected" : "Not selected")
            .accessibilityHint("Toggle task selection")
            .accessibilityIdentifier("facet.selection.task.\(task.path)")
            .accessibilityAddTraits(selected ? .isSelected : [])
        }
    }
#endif
