internal import SwiftUI
internal import TaskNotesKit

internal import struct Foundation.AttributedString

/// A parsed note body, drawn.
///
/// The parse happens in `TaskNotesKit` (see ``MarkdownBody``), which has no
/// SwiftUI at all and is therefore testable headlessly. This file is only the
/// drawing, and it is deliberately small: `Text` already renders an
/// `AttributedString`'s inline styling — emphasis, strong, strikethrough,
/// links — so the only work left is block layout, which is what `Text` has no
/// opinion about.
///
/// ## Every size and colour is semantic
///
/// No hex literals, no fixed point sizes. Headings are `.title`/`.title2`/…, so
/// they track Dynamic Type; code and quotes use the hierarchical fills, so they
/// track light and dark, Increase Contrast, and the accessibility colour
/// filters. That is what "semantic colors following system appearance" asks for,
/// and it is also why there is no in-app appearance toggle to build.
struct MarkdownBodyView: View {
    /// The parsed body. Named `content` rather than `body` for the obvious
    /// reason: `body` is already this view's own rendering.
    let content: MarkdownBody

    init(_ content: MarkdownBody) {
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(content.blocks) { block in
                MarkdownBlockView(block: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }
}

/// One block.
///
/// Exhaustive over ``MarkdownBlock/Kind`` — `default:` is banned here precisely
/// so that a block kind added to the parser becomes a compile error rather than
/// a piece of the user's note that silently stops being drawn.
private struct MarkdownBlockView: View {
    let block: MarkdownBlock

    var body: some View {
        switch block.kind {
        case .paragraph:
            Text(styled(block.text))
                .fixedSize(horizontal: false, vertical: true)

        case .heading(let level):
            Text(styled(block.text))
                .font(Self.headingFont(level))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, level <= 2 ? 4 : 0)
                .accessibilityAddTraits(.isHeader)

        case .bullet(let depth):
            marker(Text("•"), depth: depth)

        case .numbered(let depth, let ordinal):
            marker(Text("\(ordinal)."), depth: depth)

        case .quote(let depth):
            HStack(alignment: .top, spacing: 8) {
                // A rule rather than an indent: a quotation needs to be
                // distinguishable from a nested list at a glance, and the bar is
                // the convention every markdown reader already uses.
                Rectangle()
                    .fill(.quaternary)
                    .frame(width: 3)
                Text(styled(block.text))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, Self.indent * CGFloat(depth))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Quote")

        case .code(let language):
            VStack(alignment: .leading, spacing: 2) {
                if let language, !language.isEmpty {
                    Text(language)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                Text(block.text)
                    .font(.system(.callout, design: .monospaced))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(8)
            .background(.quinary, in: .rect(cornerRadius: 6))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(language.map { "\($0) code" } ?? "Code")

        case .rule:
            Divider()
                .padding(.vertical, 2)

        case .tableRow(let isHeader):
            HStack(alignment: .top, spacing: 12) {
                ForEach(Array(block.content.enumerated()), id: \.offset) { _, cell in
                    Text(styled(cell))
                        .font(isHeader ? .body.weight(.semibold) : .body)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .accessibilityElement(children: .contain)
        }
    }

    /// A list item: its marker, then its text, indented by nesting depth.
    ///
    /// The marker is `.monospacedDigit()` so a list running past nine keeps its
    /// text left edges aligned instead of stepping right at `10.`.
    private func marker(_ symbol: Text, depth: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            symbol
                .monospacedDigit()
                .foregroundStyle(.secondary)
                // Spoken by the item's own text; a bullet announced separately
                // makes a five-item list take ten VoiceOver stops to read.
                .accessibilityHidden(true)
            Text(styled(block.text))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, Self.indent * CGFloat(depth))
    }

    /// Inline code, given the one thing `Text` does not supply.
    ///
    /// SwiftUI resolves `inlinePresentationIntent` for emphasis, strong emphasis
    /// and strikethrough on its own, but `.code` has no default rendering — a
    /// backticked span comes out looking exactly like the prose around it, which
    /// makes `rm -rf` in a note indistinguishable from a sentence. Setting the
    /// font per run is the smallest correct fix, and it stays inside the
    /// paragraph rather than becoming a separate view.
    private func styled(_ value: AttributedString) -> AttributedString {
        var result = value
        for run in value.runs where run.inlinePresentationIntent?.contains(.code) == true {
            result[run.range].font = .system(.body, design: .monospaced)
            result[run.range].backgroundColor = Color.secondary.opacity(0.12)
        }
        return result
    }

    /// The six heading levels, mapped onto the type scale.
    ///
    /// A clamped lookup rather than a `switch`, and that is not a style
    /// preference: `level` is an `Int`, so a `switch` over it needs a catch-all,
    /// and `default:` is banned in this package. Clamping makes the function
    /// total instead — every input lands on a real entry, so there is no
    /// unreachable branch to write and no rule to argue with.
    ///
    /// Levels five and six share `.subheadline` with a weight bump rather than
    /// getting their own smaller sizes: below `.headline` the scale runs out,
    /// and a heading smaller than body text reads as a caption.
    private static func headingFont(_ level: Int) -> Font {
        let scale: [Font] = [
            .title2.weight(.bold),
            .title3.weight(.semibold),
            .headline,
            .body.weight(.semibold),
            .subheadline.weight(.semibold),
        ]
        return scale[min(max(level, 1), scale.count) - 1]
    }

    /// One nesting step. Wide enough to read as a level, narrow enough that four
    /// levels still fit an inspector.
    private static let indent: CGFloat = 16
}
