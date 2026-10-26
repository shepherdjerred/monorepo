import SwiftUI
import TaskNotesKit

internal struct FacetSavedViewEditorFields: View {
    @Bindable var editor: FacetSavedViewEditorModel
    let configuration: FacetValue
    let vocabulary: [String: [String]]
    @FocusState private var nameFocused: Bool
    private static let symbols = [
        ("tray", "Inbox"), ("briefcase", "Briefcase"), ("book.closed", "Book"),
        ("scope", "Focus"), ("star", "Star"), ("calendar", "Calendar"),
        ("flag", "Flag"), ("bookmark", "Bookmark"),
    ]
    private static let tints = [
        ("#0a84ff", "Blue"), ("#6366f1", "Indigo"), ("#af52de", "Purple"),
        ("#ff2d55", "Pink"), ("#ff9500", "Orange"), ("#22c55e", "Green"),
    ]

    var body: some View {
        Section("View") {
            TextField("Name", text: $editor.name)
                .accessibilityIdentifier("facet.saved-view.name")
                .focused($nameFocused)
                .onSubmit { nameFocused = false }
                #if os(iOS)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.done)
                #endif
            Picker("Symbol", selection: $editor.symbol) {
                ForEach(Self.symbols, id: \.0) { symbol, label in
                    Label(label, systemImage: symbol).tag(symbol)
                }
                if !Self.symbols.contains(where: { $0.0 == editor.symbol }) {
                    Text("\(editor.symbol) (existing)").tag(editor.symbol)
                }
            }
            Picker("Color", selection: $editor.tint) {
                ForEach(Self.tints, id: \.0) { tint, label in
                    Text(label).tag(tint)
                }
                if !Self.tints.contains(where: { $0.0 == editor.tint }) {
                    Text("Custom (existing)").tag(editor.tint)
                }
            }
            Toggle("Favorite", isOn: $editor.favorite)
            Picker("Layout", selection: $editor.viewType) {
                Label("List", systemImage: "list.bullet").tag("list")
                Label("Board", systemImage: "rectangle.split.3x1").tag("board")
                if !["list", "board"].contains(editor.viewType) {
                    Text("\(editor.viewType) (existing)").tag(editor.viewType)
                }
            }
        }
        FacetQueryEditor(query: $editor.query, configuration: configuration, vocabulary: vocabulary)
    }
}
