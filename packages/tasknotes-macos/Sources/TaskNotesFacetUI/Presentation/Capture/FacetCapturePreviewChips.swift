public import SwiftUI
public import TaskNotesKit

/// Chips display canonical properties returned by Rust. Removal is an explicit
/// override, so unchanged source text cannot silently restore a removed detail.
public struct FacetCapturePreviewChips: View {
    let preview: FacetCapturePreview
    let priorities: [(value: String, label: String)]
    let changed: (String, FacetValue) -> Void
    public init(
        preview: FacetCapturePreview, priorities: [(value: String, label: String)],
        changed: @escaping (String, FacetValue) -> Void
    ) {
        self.preview = preview
        self.priorities = priorities
        self.changed = changed
    }
    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if preview.isLoading { ProgressView("Recognising details…").controlSize(.small) }
            if let error = preview.error {
                Label(error, systemImage: "exclamationmark.triangle").font(.caption)
            }
            FacetChipLayout { chips }.disabled(preview.isLoading)
        }.accessibilityElement(children: .contain).accessibilityLabel("Recognised details")
    }
    @ViewBuilder private var chips: some View {
        ForEach(["scheduled", "due", "priority", "projects", "contexts", "tags"], id: \.self) {
            role in
            if let value = preview.properties[role], value != .null {
                ForEach(values(value), id: \.self) { label in
                    HStack(spacing: 4) {
                        Image(systemName: symbol(role)).accessibilityHidden(true)
                        Text(display(label, role: role)).fixedSize(
                            horizontal: false, vertical: true)
                        Button {
                            if value.array != nil {
                                changed(
                                    role,
                                    .array(
                                        values(value).filter { $0 != label }.map(FacetValue.string))
                                )
                            } else {
                                changed(role, .null)
                            }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain).accessibilityLabel("Remove \(role) \(label)")
                        .frame(minWidth: hitTarget, minHeight: hitTarget)
                    }.font(.caption).padding(.horizontal, 8).padding(.vertical, 6)
                        .background(.quaternary, in: Capsule())
                }
            }
        }
    }
    private func values(_ value: FacetValue) -> [String] {
        if let text = value.text { return [text] }
        return value.array?.elements.compactMap(\.text) ?? []
    }
    private var hitTarget: CGFloat {
        #if os(iOS)
            FacetPresentationTokens.shared.hitTargets.mobile
        #else
            FacetPresentationTokens.shared.hitTargets.desktop
        #endif
    }
    private func display(_ value: String, role: String) -> String {
        role == "priority" ? priorities.first(where: { $0.value == value })?.label ?? value : value
    }
    private func symbol(_ role: String) -> String {
        if role == "scheduled" || role == "due" { return "calendar" }
        if role == "priority" { return "flag" }
        if role == "projects" { return "folder" }
        if role == "contexts" { return "at" }
        if role == "tags" { return "tag" }
        preconditionFailure("Unknown capture chip role: \(role)")
    }
}
