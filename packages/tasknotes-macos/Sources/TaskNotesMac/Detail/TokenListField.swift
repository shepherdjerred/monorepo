internal import SwiftUI
internal import TaskNotesKit

/// One list of names — projects, contexts or tags — as removable tokens with
/// inline type-ahead.
///
/// ## Why this is SwiftUI and not `NSTokenField`
///
/// It was `NSTokenField`, and completion had to be dropped to ship it. That
/// control offers completions through exactly one delegate method, whose
/// Objective-C return type is `nullable NSArray *` and therefore imports as
/// `[Any]?` — an optional collection, which `discouraged_optional_collection`
/// rejects and which this package forbids suppressing. Both ways out were
/// measured again before this file was written, and both are closed:
///
///   * returning `[Any]?` is a SwiftLint error;
///   * returning `[Any]` is *"result has different optionality than expected by
///     protocol"*, which is a warning — and `.treatAllWarnings(as: .error)` in
///     `Package.swift` makes it a build failure.
///
/// The rule is not wrong on the merits; `nil` and `[]` both mean "offer nothing"
/// there, so the optionality carries no information. It is simply unsatisfiable
/// against that one AppKit signature. Rebuilding the control in SwiftUI removes
/// the conflict at its source — there is no `@objc` protocol here, so nothing
/// imposes a signature — and it is the better control anyway: the tokens
/// participate in SwiftUI focus, layout and accessibility, they carry a real
/// VoiceOver action rather than a cell's hit rectangle, and the placeholder is
/// drawn in `placeholderTextColor` instead of the control colour that made
/// `NSTokenFieldCell` render "Add project…" as a token apparently named that.
///
/// Only the text entry is still AppKit, and only for key interception; see
/// ``TokenEntryField``.
///
/// ## The vault's names are in the list, not behind a ▾ menu
///
/// The menu that stood in for completion is gone. An empty query matches
/// *everything*, so focusing the field and pressing ↓ is the same "what have I
/// called things before" affordance — except it is also filterable, reachable
/// without the mouse, and in the place the user is already typing.
///
/// ## Values are the stored spellings, always
///
/// A project lives in frontmatter as either a wikilink
/// (`[[Projects/Website|the site]]`) or a bare name. Tokens *display*
/// `projectDisplayName` and carry the stored string in and out. Round-tripping
/// the display name would rewrite every wikilink in the vault into a bare name
/// the first time anybody accepted a completion — invisible in the app, plainly
/// visible in `git diff`, and vaults are commonly in git.
struct TokenListField: View {
    /// The caption above the tokens.
    let label: String

    /// The field's accessibility identifier; every element below derives from it.
    let identifier: String

    /// The task's current values, as stored.
    let values: [String]

    /// Every name the vault already uses, in first-appearance order.
    let vocabulary: [String]

    /// How a stored value is shown.
    let display: (String) -> String

    /// Whether a vocabulary name is already on this task.
    ///
    /// A closure rather than `contains`, because for a project only the core can
    /// answer it: a wikilink covers its own display name, so plain equality would
    /// keep offering a project that is already attached under its other spelling.
    let isPresent: (String) -> Bool

    /// The placeholder, shown while the field holds nothing at all.
    let prompt: String

    /// One name to add, in its stored spelling. The caller decides what "already
    /// present" means and hands back the whole replacement list.
    let onAdd: (String) -> Void

    /// The whole replacement list, after a removal.
    let onRemove: ([String]) -> Void

    /// What is being typed, and which suggestion is highlighted.
    @State private var entry: TokenFieldEntry

    /// Whether the text entry is first responder, as AppKit reports it.
    ///
    /// Deliberately **not** derived from ``focus``. `@FocusState` can push focus
    /// into an `NSViewRepresentable` but never learns that a click landed in one,
    /// so a suggestion list gated on it would stay shut for the most common way
    /// of all to start typing. This is AppKit stating a fact; `focus` is SwiftUI
    /// being told where to put it. Both are needed and neither replaces the
    /// other.
    @State private var isEditing = false

    /// Where keyboard focus is inside this control.
    @FocusState private var focus: TokenFocus?

    init(
        label: String,
        identifier: String,
        values: [String],
        vocabulary: [String],
        display: @escaping (String) -> String,
        isPresent: @escaping (String) -> Bool,
        prompt: String,
        onAdd: @escaping (String) -> Void,
        onRemove: @escaping ([String]) -> Void,
        opening: TokenFieldOpening = .resting
    ) {
        self.label = label
        self.identifier = identifier
        self.values = values
        self.vocabulary = vocabulary
        self.display = display
        self.isPresent = isPresent
        self.prompt = prompt
        self.onAdd = onAdd
        self.onRemove = onRemove
        _entry = State(
            initialValue: TokenFieldEntry.idle.typing(opening.text)
                .highlighting(opening.highlighted))
        _isEditing = State(initialValue: opening.isEditing)
    }

    /// How many completions are offered at once.
    ///
    /// A cap rather than a scroller, and the arithmetic is the reason: the
    /// inspector is ~340 points wide and this list floats over the rows beneath
    /// it, so a list long enough to need scrolling would cover the whole Organize
    /// section. Eight is more than a filtered vocabulary usually produces, and
    /// the ninth name is one more keystroke away. The **model** is given the same
    /// capped array, so ↓ can never highlight a row that is not drawn.
    private static let visibleSuggestions = 8

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            tokenArea
            // In the layout rather than in an `.overlay`, which moves the rows
            // below down while the list is open. See ``TokenSuggestionList`` for
            // the measurement: an overlay cannot rise above the next row of a
            // grouped `Form` at any z-index, because the rows are table cells.
            suggestionList
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // The list appearing is a change of shape, so it gets a duration. Without
        // one the whole Organize section jumps by a hundred points on the first
        // keystroke, which reads as a glitch rather than as a list opening.
        .animation(.easeOut(duration: 0.12), value: isShowingSuggestions)
    }

    // ── The field ──────────────────────────────────────────────────────────

    private var tokenArea: some View {
        TokenFlowLayout {
            // Keyed by position rather than by value: two identical names are
            // possible in a vault the app did not write, and `id: \.self` would
            // collapse them into one token that removed the wrong one.
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                token(value, at: index)
            }
            entryField
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(.quinary, in: .rect(cornerRadius: 6))
        .overlay {
            // The focus indication for the whole control. The `NSTextField`
            // inside has its ring switched off, because a ring drawn around the
            // caret's own frame — the remainder of one line — would say that a
            // sliver of the row has focus rather than the field.
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(
                    isEditing ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.quaternary),
                    lineWidth: isEditing ? 2 : 1
                )
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
        .accessibilityLabel(label)
    }

    private var entryField: some View {
        TokenEntryField(
            text: entry.text,
            // The prompt belongs to an empty field. Beside three tokens it is
            // noise that also reads as a fourth, ghostly one.
            prompt: values.isEmpty ? prompt : "",
            onChange: typed,
            onKey: handle,
            onEditingChange: editingChanged
        )
        .focused($focus, equals: .entry)
        .accessibilityIdentifier(AccessibilityIdentifier.Inspector.tokenEntry(field: identifier))
        .accessibilityLabel("Add \(label.lowercased())")
    }

    // ── Tokens ─────────────────────────────────────────────────────────────

    private func token(_ value: String, at index: Int) -> some View {
        let name = display(value)
        let isFocused = focus == .token(index)
        return HStack(spacing: 3) {
            Text(name)
                .font(.callout)
                .lineLimit(1)
                .truncationMode(.middle)
            Button {
                remove(at: index)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .imageScale(.small)
                    // A rung below the name, which is the thing being read. At
                    // full strength the filled circle out-weighed the tag it was
                    // attached to, so a row of tokens read as a row of delete
                    // buttons. White while focused, because the capsule behind it
                    // is then the accent colour.
                    .foregroundStyle(isFocused ? AnyShapeStyle(.white) : AnyShapeStyle(.secondary))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(name)")
            .accessibilityIdentifier(
                AccessibilityIdentifier.Inspector.tokenRemove(field: identifier, value: value))
        }
        .foregroundStyle(isFocused ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
        .padding(.leading, 7)
        .padding(.trailing, 4)
        .padding(.vertical, 2)
        .background(isFocused ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.quaternary))
        .clipShape(.capsule)
        .focusable()
        .focused($focus, equals: .token(index))
        .onKeyPress(.leftArrow) { focusToken(index - 1) }
        .onKeyPress(.rightArrow) { focusToken(index + 1) }
        .onKeyPress(.delete) { removeFocused(index) }
        .onKeyPress(.deleteForward) { removeFocused(index) }
        .onKeyPress(.escape) { returnToEntry() }
        // `.contain` rather than `.combine`: combining would fold the remove
        // button into the label and leave a VoiceOver user with a token they can
        // read and cannot delete. The custom action is the second route to the
        // same removal, for the rotor rather than for the hit rectangle.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(
            AccessibilityIdentifier.Inspector.token(field: identifier, value: value)
        )
        .accessibilityLabel(name)
        .accessibilityAction(named: "Remove") { remove(at: index) }
    }

    // ── Completions ────────────────────────────────────────────────────────

    /// The vault's names, minus what this task already carries.
    private var choices: [TokenChoice] {
        TokenChoice.offering(vocabulary: vocabulary, display: display, isPresent: isPresent)
    }

    /// The names offered for what is currently typed, exactly as drawn.
    private var suggestions: [TokenChoice] {
        Array(TokenField.matches(query: entry.text, in: choices).prefix(Self.visibleSuggestions))
    }

    private var isShowingSuggestions: Bool {
        isEditing && !entry.isDismissed && !suggestions.isEmpty
    }

    /// The highlight, clamped to what is on screen.
    ///
    /// The list shrinks whenever a token is added, and a stale index would either
    /// highlight the wrong name or trap. Clamped at the point of reading rather
    /// than guarded at every writer.
    private var highlighted: Int? {
        entry.highlighted.flatMap { suggestions.indices.contains($0) ? $0 : nil }
    }

    @ViewBuilder
    private var suggestionList: some View {
        if isShowingSuggestions {
            TokenSuggestionList(
                suggestions: suggestions,
                highlighted: highlighted,
                label: label,
                identifier: identifier,
                onChoose: choose,
                onHover: hover
            )
        }
    }

    // ── Editing ────────────────────────────────────────────────────────────

    /// Text arrived: finish anything the user comma-separated, keep the rest.
    private func typed(_ value: String) {
        let split = TokenField.tokenising(value)
        for name in split.completed {
            onAdd(name)
        }
        entry = entry.typing(split.remainder)
    }

    /// A key the field handed over. The result is whether it was consumed.
    private func handle(_ key: TokenFieldKey) -> Bool {
        perform(
            TokenField.effect(
                of: key,
                entry: entry,
                suggestions: suggestions,
                hasValues: !values.isEmpty
            )
        )
    }

    @discardableResult
    private func perform(_ effect: TokenFieldEffect) -> Bool {
        switch effect {
        case .ignored:
            return false
        case .entry(let next):
            entry = next
            return true
        case .add(let name):
            entry = .idle
            onAdd(name)
            return true
        case .removeLast:
            remove(at: values.count - 1)
            return true
        case .focusLastToken:
            focus = .token(values.count - 1)
            return true
        }
    }

    /// AppKit says the field gained or lost first responder.
    ///
    /// Losing it commits whatever is typed, which is how every other field in
    /// this inspector behaves — a panel closed with ⌥⌘I mid-edit must not
    /// silently drop the name. It routes through the same `.commit` the Return
    /// key does, so a highlighted suggestion still wins over the raw text.
    private func editingChanged(_ editing: Bool) {
        isEditing = editing
        guard !editing else {
            // AppKit has moved first responder here — by a click, most likely,
            // which SwiftUI's focus never saw. Without this the control would go
            // on drawing a token as focused while the caret blinked in the text
            // field, and SwiftUI would be free to yank focus back to that token
            // on its next update.
            focus = .entry
            return
        }
        perform(
            TokenField.effect(
                of: .commit,
                entry: entry,
                suggestions: suggestions,
                hasValues: !values.isEmpty
            )
        )
    }

    private func choose(_ choice: TokenChoice) {
        entry = .idle
        onAdd(choice.stored)
        // Straight back to typing: picking one name from a vault is rarely the
        // last thing anybody does to a task's tags.
        focus = .entry
    }

    private func hover(_ index: Int, _ isInside: Bool) {
        if isInside {
            entry.highlighted = index
        } else if entry.highlighted == index {
            entry.highlighted = nil
        }
    }

    // ── Removal and focus ──────────────────────────────────────────────────

    /// Drop one token and dispatch the whole remaining list.
    ///
    /// The bounds check is a real one rather than a defensive habit: `values` is
    /// the store's snapshot, a removal is optimistic, and a second key press
    /// arriving before the next snapshot would otherwise index past the end.
    private func remove(at index: Int) {
        guard values.indices.contains(index) else { return }
        var remaining = values
        remaining.remove(at: index)
        onRemove(remaining)
    }

    /// Move token focus, or hand it back to the text entry off the right edge.
    private func focusToken(_ index: Int) -> KeyPress.Result {
        guard index >= 0 else { return .ignored }
        guard values.indices.contains(index) else { return returnToEntry() }
        focus = .token(index)
        return .handled
    }

    /// Remove the focused token and keep focus somewhere sensible.
    private func removeFocused(_ index: Int) -> KeyPress.Result {
        let remaining = values.count - 1
        remove(at: index)
        guard remaining > 0 else { return returnToEntry() }
        focus = .token(min(index, remaining - 1))
        return .handled
    }

    private func returnToEntry() -> KeyPress.Result {
        focus = .entry
        return .handled
    }
}

/// The state a token field opens in.
///
/// Every real call site takes ``resting`` by default; nothing in the app
/// constructs another one. It exists because the **completion list cannot be
/// reached offscreen**: opening it needs first-responder status, and the snapshot
/// layer's window is deliberately never ordered in and never made key — see
/// `OffscreenSnapshot`, where that is a hard requirement rather than a
/// preference.
///
/// The alternative was no image of the type-ahead at all, which is the wrong
/// trade in this package specifically: an `NSViewRepresentable` that renders
/// blank is not a compile error, it has already happened here once, and the
/// floating list is the part of this control most likely to be visually wrong.
struct TokenFieldOpening {
    /// What is already in the text entry.
    var text: String = ""

    /// Which suggestion is highlighted.
    var highlighted: Int?

    /// Whether the field is drawn as though it had first-responder status.
    var isEditing: Bool = false

    /// A field nobody has touched.
    static let resting = TokenFieldOpening()
}

/// Where keyboard focus can sit inside a token field.
///
/// One enum rather than two `@FocusState` properties, because the two places are
/// mutually exclusive and a pair of them could disagree — a token drawn as
/// focused while the caret blinks in the text field is a state that simply
/// cannot be spelled here.
private enum TokenFocus: Hashable {
    /// The text entry.
    case entry

    /// A token, by position.
    case token(Int)
}
