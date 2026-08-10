internal import SwiftUI
internal import TaskNotesKit

/// Naming a query, or renaming one already named.
///
/// ## What is *not* here, and why
///
/// There is no filter builder in this sheet. A saved view is the query you were
/// already looking at, so the way you build one is to narrow a list until it
/// shows what you want and then keep it — which is how every "smart folder" on
/// this platform works, and it means the filter surface has exactly one
/// implementation instead of a real one in the toolbar and a lesser one here.
///
/// The React Native app has no creation flow at all; `DEFAULT_SAVED_VIEWS` is a
/// constant. This is the desktop half of the same feature, and it is the reason
/// those two views are *seeded* rather than hard-coded — a default you cannot
/// delete would be the odd one out once anything else can be created.
struct SavedViewEditor: View {
    /// What the sheet is doing.
    ///
    /// `Identifiable` so it can drive `.sheet(item:)`, which is the
    /// presentation form that carries its subject with it — a `.sheet(isPresented:)`
    /// beside a separate `@State` subject is the shape where the sheet opens
    /// one frame before the subject changes and renames the wrong view.
    enum Mode: Equatable, Identifiable {
        /// Keep the narrowing the frontmost screen is showing.
        case create(SavedViewDraft)
        /// Rename or re-symbol one that already exists.
        case edit(SavedView)

        var id: String {
            switch self {
            case .create: "create"
            case .edit(let view): "edit.\(view.id)"
            }
        }
    }

    let mode: Mode
    let store: SavedViewStore

    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var symbol: SavedViewSymbol
    @FocusState private var isNameFocused: Bool

    init(mode: Mode, store: SavedViewStore) {
        self.mode = mode
        self.store = store
        switch mode {
        case .create:
            _name = State(initialValue: "")
            _symbol = State(initialValue: .star)
        case .edit(let view):
            _name = State(initialValue: view.name)
            _symbol = State(initialValue: view.symbol)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(title)
                .font(.headline)

            Form {
                TextField("Name", text: $name, prompt: Text("Job Search"))
                    .focused($isNameFocused)
                    .accessibilityIdentifier(AccessibilityIdentifier.SavedViews.editorName)
                    .onSubmit(commit)
                LabeledContent("Symbol") { symbolPicker }
            }
            .formStyle(.columns)

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button(confirmTitle, action: commit)
                    .keyboardShortcut(.defaultAction)
                    // A view with no name is a sidebar row nobody can read or
                    // click, so the button is disabled rather than the store
                    // being left to refuse it after the sheet has closed.
                    .disabled(name.trimmingWhitespace().isEmpty)
                    .accessibilityIdentifier(AccessibilityIdentifier.SavedViews.editorConfirm)
            }
        }
        .padding(20)
        .frame(width: 380)
        // `.contain`, not `.combine`: this sheet holds a name field, a symbol
        // picker and a confirm button, and combining would flatten all three
        // into one element with no separate actions. An identifier on a bare
        // container never reaches the accessibility tree at all — see the note
        // on ``AccessibilityIdentifier``.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(AccessibilityIdentifier.SavedViews.editor)
        // The name is the only thing anybody comes here to type.
        .onAppear { isNameFocused = true }
    }

    /// A row of symbols rather than a `Picker`.
    ///
    /// Ten glyphs in a pop-up menu would be ten identical-looking rows named
    /// "Briefcase", "Book", "Flag" — a list of words for a choice that is
    /// entirely visual. Laid out as buttons, the choice is made by looking.
    private var symbolPicker: some View {
        HStack(spacing: 4) {
            ForEach(SavedViewSymbol.allCases, id: \.self) { choice in
                Button {
                    symbol = choice
                } label: {
                    Image(systemName: choice.systemImage)
                        .frame(width: 22, height: 22)
                }
                .buttonStyle(.borderless)
                // Selection is a filled background from the accent colour, not
                // a colour swapped into the glyph: the glyph's own colour has
                // to stay constant, because that is what makes the ten of them
                // comparable at a glance.
                .background(
                    symbol == choice
                        ? AnyShapeStyle(Color.accentColor.opacity(0.25))
                        : AnyShapeStyle(.clear),
                    in: .rect(cornerRadius: 4)
                )
                .help(choice.title)
                .accessibilityLabel(choice.title)
                .accessibilityAddTraits(symbol == choice ? [.isSelected] : [])
                .accessibilityIdentifier(
                    AccessibilityIdentifier.SavedViews.editorSymbol(choice.rawValue))
            }
        }
    }

    private var title: String {
        switch mode {
        case .create: "New Saved View"
        case .edit: "Edit Saved View"
        }
    }

    private var confirmTitle: String {
        switch mode {
        case .create: "Save"
        case .edit: "Done"
        }
    }

    private func commit() {
        guard !name.trimmingWhitespace().isEmpty else { return }
        switch mode {
        case .create(let draft):
            store.save(name: name, symbol: symbol, draft: draft)
        case .edit(let view):
            var updated = view
            updated.name = name.trimmingWhitespace()
            updated.symbol = symbol
            store.update(updated)
        }
        dismiss()
    }
}
