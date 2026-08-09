internal import AppKit
internal import SwiftUI
internal import TaskNotesKit

/// The completions a token field shows beneath itself while you type.
///
/// Its own type rather than a `@ViewBuilder` on ``TokenListField``: it holds no
/// state and decides nothing, and it renders exactly the array the model was
/// asked about — so the list on screen and the list ↑/↓ walks cannot disagree.
///
/// ## 🔴 It does not float, and that was measured rather than chosen
///
/// The first version was an `.overlay` positioned below the field with
/// `.zIndex(1)` on the row, which is how a completion menu ought to work. **It
/// does not work inside a grouped `Form`.** The rendered snapshot showed the
/// *next* row — the Contexts label and its `@home` token — drawn on top of the
/// completions; re-rendering with an opaque red background confirmed the cause
/// was compositing rather than translucency, because the red occluded nothing.
///
/// The reason is in this package's own notes: a `List` is `NSTableView`
/// underneath, a grouped `Form` is built the same way, and each row is a separate
/// cell. `.zIndex` orders children *within* a layout container, and two table
/// cells are not that — so no overlay drawn inside a row can rise above the row
/// after it, at any z-index.
///
/// So the list takes real space instead, and the rows below it move down while it
/// is open. That is the honest trade: it can never be occluded, never be clipped
/// by the inspector's scroll view, and needs no coordinate arithmetic. The
/// alternative that would still float — publishing an `Anchor<CGRect>` preference
/// and drawing the list in an overlay on the whole `Form` — is recorded here
/// rather than built, because it moves the list outside the table's cells and
/// into geometry that the same `NSTableView` backing makes unreliable for rows
/// that are scrolled out of view.
struct TokenSuggestionList: View {
    /// The names on offer, already filtered and already capped.
    let suggestions: [TokenChoice]

    /// Which one is highlighted, already clamped to the array above.
    let highlighted: Int?

    /// The field's caption, for the list's own accessibility label.
    let label: String

    /// The field's accessibility identifier; each row derives from it.
    let identifier: String

    /// A name was chosen, by click or by Return.
    let onChoose: (TokenChoice) -> Void

    /// The pointer entered or left a row.
    let onHover: (Int, Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(suggestions.enumerated()), id: \.element) { index, choice in
                row(choice, at: index)
            }
        }
        .padding(4)
        // An opaque surface rather than a material, so the list reads as its own
        // plane against the grouped row's fill. There is nothing behind it to
        // show through any more, but a material here was also simply the wrong
        // colour: it took the row's grey and the list stopped being a list.
        .background(Color(nsColor: .controlBackgroundColor), in: .rect(cornerRadius: 6))
        .overlay {
            RoundedRectangle(cornerRadius: 6).strokeBorder(.quaternary)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(
            AccessibilityIdentifier.Inspector.tokenSuggestions(field: identifier)
        )
        .accessibilityLabel("\(label) suggestions")
    }

    private func row(_ choice: TokenChoice, at index: Int) -> some View {
        let isHighlighted = highlighted == index
        return Button {
            onChoose(choice)
        } label: {
            Text(choice.display)
                // The same size the name will be once it is a token. At the form
                // body size the completions came out visibly larger than the
                // tokens above them, so accepting one appeared to shrink it.
                .font(.callout)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .foregroundStyle(isHighlighted ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                .background(
                    isHighlighted ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.clear)
                )
                .clipShape(.rect(cornerRadius: 4))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        // Hovering moves the highlight, which is what a menu does — and it is
        // also what makes a mouse click safe. Leaving the field commits whatever
        // is highlighted, so a pointer resting on "urgent" while the field still
        // says "urg" commits *urgent* whether the click or the blur lands first.
        // Both routes then add the same name, and the caller's own
        // de-duplication absorbs the second.
        .onHover { isInside in onHover(index, isInside) }
        .accessibilityIdentifier(
            AccessibilityIdentifier.Inspector.tokenSuggestion(
                field: identifier, value: choice.stored))
    }
}
