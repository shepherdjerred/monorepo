import AppKit
import SwiftUI

/// Read-only, selectable monospaced text in an AppKit text view. Raw
/// request bodies run to hundreds of kilobytes, past what one SwiftUI
/// `Text` renders, so this lays them out lazily and scrolls both ways.
struct MonospacedTextView: NSViewRepresentable {
  let text: String

  func makeNSView(context: Context) -> NSScrollView {
    let scrollView = NSTextView.scrollableTextView()
    scrollView.drawsBackground = false
    scrollView.hasHorizontalScroller = true
    if let textView = scrollView.documentView as? NSTextView {
      textView.isEditable = false
      textView.isSelectable = true
      textView.drawsBackground = false
      textView.font = .monospacedSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
      textView.textColor = .labelColor
      textView.textContainerInset = NSSize(width: 6, height: 6)
      textView.isHorizontallyResizable = true
      textView.maxSize = NSSize(
        width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
      textView.textContainer?.widthTracksTextView = false
      textView.textContainer?.containerSize = NSSize(
        width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
      textView.string = text
    }
    return scrollView
  }

  func updateNSView(_ scrollView: NSScrollView, context: Context) {
    guard let textView = scrollView.documentView as? NSTextView, textView.string != text else {
      return
    }
    textView.string = text
    textView.scrollToBeginningOfDocument(nil)
  }
}
