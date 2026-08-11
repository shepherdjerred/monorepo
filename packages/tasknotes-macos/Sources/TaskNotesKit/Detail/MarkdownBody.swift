// Foundation whole rather than a granular list: `AttributedString`,
// `PresentationIntent`, `AttributedString.MarkdownParsingOptions` and the
// `presentationIntent` attribute key are four separate declarations plus an
// attribute scope, and the scope is what makes `run.presentationIntent` resolve
// at all under `MemberImportVisibility`. Public because `AttributedString` is in
// this type's surface.
public import Foundation
public import TaskNotesUniFFI

/// A task's note body, parsed into blocks a SwiftUI view can lay out.
///
/// ## The parse is Foundation's, and that is the whole point
///
/// The app **edits markdown source as plain text and renders it read-only**,
/// matching the React Native app; there is no WYSIWYG here and macOS 15 costs
/// nothing because of it. Rendering still needs a real parse, and the parse used
/// is `AttributedString(markdown:options:)` — Foundation's own GitHub-Flavored
/// Markdown reader, cmark-gfm underneath. Nothing about markdown syntax is
/// decided in this file: headings, emphasis, lists, block quotes, fenced code,
/// thematic breaks, links and GFM tables all arrive already identified, and the
/// code below only reshapes them into something a `VStack` can walk.
///
/// A hand-rolled markdown reader was never on the table, and neither was
/// MarkdownUI, which is formally in maintenance mode.
///
/// ⚠️ **Reported deviation.** The brief asked for `swift-markdown` as the
/// parser. Adding it means a new remote SwiftPM dependency, which means editing
/// `Package.swift` — explicitly out of scope for this work, and a file a
/// concurrently running agent could be in. Foundation's parser is the same
/// cmark-gfm engine with no manifest change and no third-party package, so
/// nothing is hand-rolled either way. ``MarkdownBlock`` is deliberately
/// parser-shaped rather than Foundation-shaped: swapping the body of
/// ``of(source:)`` for a `swift-markdown` walk changes nothing above it, and
/// would buy a real AST — proper nested-list trees and GFM task-list items,
/// which are the two things the flattening below genuinely gives up.
///
/// ## Why blocks and not one `AttributedString`
///
/// `Text` renders an `AttributedString`'s *inline* styling — emphasis, strong,
/// code, strikethrough, links — but has no idea what a list item or a fenced
/// code block should look like, because those are layout rather than styling.
/// Handing the whole body to one `Text` produces a wall of prose with the
/// bullets missing. Splitting on `presentationIntent` is what puts the block
/// structure back where a view can act on it.
public struct MarkdownBody: Sendable, Equatable {
    /// The blocks, in document order.
    public let blocks: [MarkdownBlock]

    /// Whether there is anything to render.
    public var isEmpty: Bool { blocks.isEmpty }

    /// Parse a note body.
    ///
    /// - Parameter source: the markdown source, exactly as the vault holds it.
    /// - Returns: the blocks, or an empty body for empty source.
    /// - Throws: `CoreError.Validation` when Foundation cannot read the source
    ///   even partially. The failure policy already asks for a partial parse, so
    ///   reaching this means something is very wrong with the bytes — and a
    ///   silent fallback to "render it as one paragraph" would hide exactly the
    ///   case worth seeing.
    public static func of(source: String) throws(CoreError) -> MarkdownBody {
        guard !source.trimmingWhitespace().isEmpty else { return MarkdownBody(blocks: []) }
        let attributed = try CoreErrors.validating("the note body is not readable as markdown") {
            try AttributedString(
                markdown: source,
                options: AttributedString.MarkdownParsingOptions(
                    allowsExtendedAttributes: true,
                    // `.full` is what produces `presentationIntent` at all. The
                    // default, `.inlineOnlyPreservingWhitespace`, reports no
                    // block structure — so every heading and list item would
                    // arrive as an ordinary paragraph.
                    interpretedSyntax: .full,
                    failurePolicy: .returnPartiallyParsedIfPossible
                )
            )
        }
        return MarkdownBody(blocks: assemble(atoms: atoms(of: attributed)))
    }

    // ── The two passes ─────────────────────────────────────────────────────

    /// One contiguous stretch of text sharing a single block intent.
    private struct Atom {
        let intent: PresentationIntent?
        let text: AttributedString
    }

    /// Split the parsed string wherever the block intent changes.
    ///
    /// Adjacent paragraphs do **not** merge: `PresentationIntent` carries an
    /// `identity` per component, so two paragraphs compare unequal even though
    /// both are `.paragraph`. That identity is the only thing separating them —
    /// the text itself has no blank line left in it — so equality on the whole
    /// intent is the split, and comparing only the *kind* would silently glue
    /// every paragraph in a note into one.
    private static func atoms(of attributed: AttributedString) -> [Atom] {
        var built: [Atom] = []
        for run in attributed.runs {
            let slice = AttributedString(attributed[run.range])
            if let last = built.last, last.intent == run.presentationIntent {
                built[built.count - 1] = Atom(intent: last.intent, text: last.text + slice)
            } else {
                built.append(Atom(intent: run.presentationIntent, text: slice))
            }
        }
        return built
    }

    /// Turn atoms into blocks, merging a table's cells back into its rows.
    ///
    /// Table cells arrive one atom each, because every cell carries its own
    /// `tableCell` component with its own column index. A row is the run of
    /// consecutive cells sharing a row identity, and merging them here is what
    /// lets the view lay a table out as a grid rather than as a column of
    /// stray words.
    private static func assemble(atoms: [Atom]) -> [MarkdownBlock] {
        var assembled: [MarkdownBlock] = []
        var pending: PendingTableRow?

        func flushRow() {
            guard let row = pending else { return }
            assembled.append(
                MarkdownBlock(
                    id: assembled.count,
                    kind: .tableRow(isHeader: row.reference.isHeader),
                    content: row.cells
                )
            )
            pending = nil
        }

        for atom in atoms {
            let shape = BlockShape(of: atom.intent)
            if let reference = shape.tableRow {
                if pending?.reference != reference {
                    flushRow()
                    pending = PendingTableRow(reference: reference, cells: [])
                }
                pending?.cells.append(atom.text)
                continue
            }
            flushRow()
            assembled.append(
                MarkdownBlock(
                    id: assembled.count, kind: shape.kind, content: [shape.render(atom.text)])
            )
        }
        flushRow()
        return assembled
    }

    /// A table row being accumulated from its cells.
    private struct PendingTableRow {
        let reference: TableRowReference
        var cells: [AttributedString]
    }
}

/// Which table row a cell belongs to.
///
/// A named type rather than a tuple: it is compared for identity in the merge
/// loop, and a tuple that grew a third member would silently change what
/// "the same row" means.
private struct TableRowReference: Equatable {
    /// Foundation's own identity for the row component.
    let identity: Int
    let isHeader: Bool
}

/// One laid-out piece of a note body.
///
/// A struct with a kind rather than an enum of eight cases, because the view
/// needs a stable `id` for `ForEach` on every one of them and eight cases would
/// each have to carry it. The id is the block's position, which is stable for as
/// long as the source is — and the source only changes when the user commits an
/// edit, at which point the whole body is re-parsed anyway.
public struct MarkdownBlock: Sendable, Equatable, Identifiable {
    /// Position in the document.
    public let id: Int

    /// What kind of block this is.
    public let kind: Kind

    /// The block's inline-styled text.
    ///
    /// One entry for every kind except ``Kind/tableRow(isHeader:)``, which has
    /// one per cell. ``text`` is the convenience for the common case.
    public let content: [AttributedString]

    /// The single piece of text, for every kind but a table row.
    public var text: AttributedString { content.first ?? AttributedString() }

    public init(id: Int, kind: Kind, content: [AttributedString]) {
        self.id = id
        self.kind = kind
        self.content = content
    }

    /// The block shapes a note body can hold.
    ///
    /// ⚠️ Nesting is a **depth**, not a tree. Foundation reports a nested list
    /// as a run of `listItem` components rather than as a hierarchy, and
    /// counting them is enough to indent correctly, which is all a read-only
    /// renderer needs. It is not enough to renumber a nested ordered list
    /// independently of its parent — that is one of the two things a real AST
    /// would buy, and it is recorded on ``MarkdownBody`` rather than pretended
    /// away here.
    public enum Kind: Sendable, Equatable {
        case paragraph
        case heading(level: Int)
        case bullet(depth: Int)
        case numbered(depth: Int, ordinal: Int)
        case quote(depth: Int)
        case code(language: String?)
        case rule
        case tableRow(isHeader: Bool)
    }
}

/// Reading a `PresentationIntent` into a block shape.
///
/// Every branch below is a translation of something Foundation already decided.
/// The only judgement here is which of Foundation's kinds collapse together —
/// `.orderedList` and `.unorderedList` are carried by their `listItem` siblings,
/// and `.table` is carried by its rows — and collapsing them is what keeps the
/// renderer from needing to understand containers it never draws.
private struct BlockShape {
    let kind: MarkdownBlock.Kind

    /// The row this atom belongs to, when it is a table cell.
    let tableRow: TableRowReference?

    init(of intent: PresentationIntent?) {
        guard let intent else {
            self.kind = .paragraph
            self.tableRow = nil
            return
        }
        let reading = IntentReading(of: intent.components)
        self.tableRow = reading.tableRow
        self.kind = reading.kind
    }

    /// The text as the block should hold it.
    ///
    /// Only fenced code needs a change: Foundation hands back the block with its
    /// terminating newline attached, and a code view that keeps it draws a blank
    /// last line inside the box.
    func render(_ text: AttributedString) -> AttributedString {
        guard case .code = kind else { return text }
        var trimmed = text
        while trimmed.characters.last == "\n" {
            let end = trimmed.endIndex
            trimmed.removeSubrange(trimmed.index(end, offsetByCharacters: -1)..<end)
        }
        return trimmed
    }
}

/// Everything one block intent's components say, gathered by concern.
///
/// ## Three passes, not one switch
///
/// The obvious shape is a single exhaustive `switch` over
/// `PresentationIntent.Kind` — and that is what this was, at twelve cases and a
/// cyclomatic complexity of twenty-one. Three focused readers over the same
/// component list are cheaper to read and each one has a single job.
///
/// The exhaustive switch is not being given up for much, either.
/// `PresentationIntent.Kind` is a **resilient** Foundation enum, so it already
/// required `@unknown default` — the compiler was never going to fail a build
/// because Foundation added a kind, which is the guarantee an exhaustive switch
/// exists to buy. What is left is a pattern match per concern, and a kind
/// nobody reads simply contributes nothing, which is the correct behaviour for
/// a display-only surface: the text is still drawn, as a paragraph.
private struct IntentReading {
    private var heading: Int?
    private var listDepth = 0
    private var ordinal: Int?
    private var listStyle: ListStyle?
    private var quoteDepth = 0
    private var language: String?
    private var isCode = false
    private var isRule = false
    private var isCell = false
    private var row: TableRowReference?

    /// Whether the innermost enclosing list numbers its items.
    ///
    /// ⚠️ Read from the list **container**, never inferred from the presence of
    /// an ordinal. Foundation numbers the items of a *bullet* list too —
    /// `- alpha` arrives as `paragraph | listItem 1 | unorderedList` — so keying
    /// off the ordinal renders every bullet list as "1. 2. 3.". A test caught
    /// exactly that.
    private enum ListStyle {
        case ordered
        case unordered
    }

    init(of components: [PresentationIntent.IntentType]) {
        readBlock(components)
        readList(components)
        readTable(components)
    }

    /// The row this cell belongs to, when the intent is a table cell.
    var tableRow: TableRowReference? {
        isCell ? row : nil
    }

    /// The shape the reading adds up to.
    ///
    /// Ordered by specificity rather than by Foundation's component order: a
    /// fenced block inside a list item is a code block first.
    var kind: MarkdownBlock.Kind {
        if isCell, let row { return .tableRow(isHeader: row.isHeader) }
        if isRule { return .rule }
        if isCode { return .code(language: language) }
        if let heading { return .heading(level: heading) }
        if listDepth > 0 {
            let depth = listDepth - 1
            guard listStyle == .ordered, let ordinal else { return .bullet(depth: depth) }
            return .numbered(depth: depth, ordinal: ordinal)
        }
        if quoteDepth > 0 { return .quote(depth: quoteDepth - 1) }
        return .paragraph
    }

    /// Headings, fenced code, rules and quotes — the kinds that stand alone.
    private mutating func readBlock(_ components: [PresentationIntent.IntentType]) {
        for component in components {
            if case .header(let level) = component.kind { heading = level }
            if case .codeBlock(let hint) = component.kind {
                isCode = true
                language = hint
            }
            if case .thematicBreak = component.kind { isRule = true }
            if case .blockQuote = component.kind { quoteDepth += 1 }
        }
    }

    /// List nesting, numbering, and which kind of list the item is in.
    ///
    /// Components run innermost-first, so the first container seen is the one
    /// this item belongs to — an outer ordered list must not renumber a nested
    /// bullet list inside it.
    private mutating func readList(_ components: [PresentationIntent.IntentType]) {
        for component in components {
            if case .orderedList = component.kind {
                listDepth += 1
                listStyle = listStyle ?? .ordered
            }
            if case .unorderedList = component.kind {
                listDepth += 1
                listStyle = listStyle ?? .unordered
            }
            if case .listItem(let position) = component.kind { ordinal = ordinal ?? position }
        }
    }

    /// Whether this is a table cell, and which row it is in.
    private mutating func readTable(_ components: [PresentationIntent.IntentType]) {
        for component in components {
            if case .tableCell = component.kind { isCell = true }
            if case .tableHeaderRow = component.kind {
                row = TableRowReference(identity: component.identity, isHeader: true)
            }
            if case .tableRow = component.kind {
                row = TableRowReference(identity: component.identity, isHeader: false)
            }
        }
    }
}
