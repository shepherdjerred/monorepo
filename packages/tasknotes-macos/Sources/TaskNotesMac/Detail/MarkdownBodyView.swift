internal import SwiftUI
internal import TaskNotesFacetUI
internal import TaskNotesKit

/// The retained client and standalone shell share the same native Markdown rendering.
struct MarkdownBodyView: View {
    let content: MarkdownBody
    init(_ content: MarkdownBody) { self.content = content }
    var body: some View { FacetMarkdownBodyView(content) }
}
