import SwiftUI
import TaskNotesKit
import Testing

@testable import TaskNotesMac

/// The token field, rendered offscreen for human review.
///
/// Same posture as the other snapshot suites: no golden files, both appearances
/// every time, and the only assertions are that a real image came out.
///
/// ## Why this control gets its own suite rather than riding on the inspector's
///
/// Two of its three states are unreachable from `inspector-populated`. A field
/// with **no** tokens is what every newly created task shows and is where the
/// placeholder either reads as an invitation or as a value; a field **mid
/// completion** is the entire feature and floats a list over the rows beneath
/// it, which is a z-order and clipping question that only an image can answer.
///
/// It also covers a failure mode this package has already been bitten by:
/// ``TokenEntryField`` is an `NSViewRepresentable`, and one that renders nothing
/// is not a compile error. The empty-field image is the one where that would show
/// up as an empty box.
@Suite("The token field, rendered offscreen", .serialized)
@MainActor
struct TokenFieldSnapshotTests {
    /// The vault's tags, as the inspector would offer them.
    private static let vocabulary = [
        "urgent", "waiting", "errand", "reading", "finance", "home", "work",
    ]

    /// A field nobody has typed into yet.
    ///
    /// The placeholder state, and the blank-render canary.
    @Test("the token field, empty", arguments: SnapshotAppearance.allCases)
    func empty(appearance: SnapshotAppearance) throws {
        try record(
            harness(values: []),
            named: "token-field-empty",
            size: Self.fieldSize,
            appearance: appearance
        )
    }

    /// Enough tokens to wrap onto more than one line.
    ///
    /// The measurement that killed the `HStack`: a ~340-point inspector cannot
    /// hold five tag capsules on one line, and a control that compressed or hid
    /// them would be lying about the task's data.
    @Test("the token field, several tokens", arguments: SnapshotAppearance.allCases)
    func populated(appearance: SnapshotAppearance) throws {
        try record(
            harness(values: ["urgent", "waiting", "reading", "finance", "home"]),
            named: "token-field-tokens",
            size: Self.fieldSize,
            appearance: appearance
        )
    }

    /// A very long name, which is the case that decides whether the layout
    /// truncates or overflows its column.
    @Test("the token field, a name wider than the column", arguments: SnapshotAppearance.allCases)
    func overlongToken(appearance: SnapshotAppearance) throws {
        try record(
            harness(values: ["quarterly-budget-reconciliation-and-forecast", "home"]),
            named: "token-field-overlong",
            size: Self.fieldSize,
            appearance: appearance
        )
    }

    /// Mid completion, in a grouped `Form` with a second field beneath it.
    ///
    /// The second field is the point of the image rather than scenery: the
    /// suggestion list floats *outside* its own row's bounds, so this is the only
    /// way to see whether it draws over the row below or gets painted under it.
    @Test("the token field, mid completion", arguments: SnapshotAppearance.allCases)
    func completing(appearance: SnapshotAppearance) throws {
        try record(
            CompletionHarness(),
            named: "token-field-completing",
            size: Self.formSize,
            appearance: appearance
        )
    }

    /// One field on a plain background, at the inspector's column width.
    private func harness(values: [String]) -> some View {
        TokenListField(
            label: "Tags",
            identifier: AccessibilityIdentifier.Inspector.tags,
            values: values,
            vocabulary: Self.vocabulary,
            display: { "#\($0)" },
            isPresent: { values.contains($0) },
            prompt: "Add tag…",
            onAdd: { _ in },
            onRemove: { _ in }
        )
        .padding(16)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    /// The inspector's column width, which is what every layout decision here
    /// was made against.
    private static let fieldSize = CGSize(width: 340, height: 160)

    /// Tall enough for a form section plus the floating list.
    private static let formSize = CGSize(width: 340, height: 320)
}

/// Two token fields in a grouped section, the first one completing.
///
/// A real `Form` rather than a `VStack`, because the question the image answers
/// is about how the floating list interacts with the form row beneath it, and a
/// `VStack` would not reproduce either the row backgrounds or the z-ordering.
private struct CompletionHarness: View {
    var body: some View {
        Form {
            Section("Organize") {
                TokenListField(
                    label: "Tags",
                    identifier: AccessibilityIdentifier.Inspector.tags,
                    values: ["urgent", "waiting"],
                    vocabulary: ["reading", "recurring", "receipts", "finance", "home", "work"],
                    display: { "#\($0)" },
                    isPresent: { ["urgent", "waiting"].contains($0) },
                    prompt: "Add tag…",
                    onAdd: { _ in },
                    onRemove: { _ in },
                    // `re` matches three of the six, and the second is
                    // highlighted — so the image shows the filter, the highlight,
                    // and the rows that did not match all at once.
                    opening: TokenFieldOpening(text: "re", highlighted: 1, isEditing: true)
                )
                TokenListField(
                    label: "Contexts",
                    identifier: AccessibilityIdentifier.Inspector.contexts,
                    values: ["home"],
                    vocabulary: ["home", "errands", "work"],
                    display: { "@\($0)" },
                    isPresent: { $0 == "home" },
                    prompt: "Add context…",
                    onAdd: { _ in },
                    onRemove: { _ in }
                )
            }
        }
        .formStyle(.grouped)
    }
}
