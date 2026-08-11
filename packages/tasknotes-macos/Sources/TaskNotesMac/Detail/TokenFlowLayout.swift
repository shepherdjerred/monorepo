internal import SwiftUI

/// Tokens laid left to right, wrapping, with the text entry taking the rest of
/// whatever line it lands on.
///
/// ## Why a `Layout` and not an `HStack`
///
/// The inspector column is ~340 points wide and a task can carry several
/// projects. An `HStack` would either compress every token until each one read
/// `Adm…` or push the last ones off the edge — and a field that silently hides
/// one of a task's projects is worse than one that is taller. That was measured
/// on the previous `NSTokenField` implementation, which needed the same fix for
/// the same reason.
///
/// SwiftUI has no flow layout on macOS 15, so this is the smallest honest one:
/// each subview at its ideal size, wrapped at the proposed width, rows centred
/// against each other so a capsule and a text baseline do not sit at different
/// heights.
///
/// ## The last subview is special, and it has to be
///
/// It is the text entry, and it gets **the remainder of its line** rather than
/// its ideal width, because an insertion point needs somewhere to go: a field
/// sized to its current contents is zero points wide when empty, which is
/// unclickable and invisible. When the remainder is narrower than
/// ``minimumEntryWidth`` the entry wraps to a line of its own instead of being
/// squeezed into a corner.
struct TokenFlowLayout: Layout {
    /// Between two items on the same line.
    var spacing: CGFloat = 4

    /// Between lines.
    var lineSpacing: CGFloat = 4

    /// The narrowest the trailing entry may be before it takes its own line.
    var minimumEntryWidth: CGFloat = 90

    /// The width assumed when SwiftUI proposes none.
    ///
    /// A flow layout has no natural width — it answers "how tall am I *at* a
    /// width" — so an unspecified or infinite proposal has to be given a number
    /// rather than be reported as one very long line, which is what collapses
    /// the control to a single row exactly when it is being asked how tall it
    /// wants to be.
    private static let assumedWidth: CGFloat = 240

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        flow(subviews: subviews, width: resolved(proposal)).size
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let placements = flow(subviews: subviews, width: bounds.width).placements
        for placement in placements {
            subviews[placement.index].place(
                at: CGPoint(
                    x: bounds.minX + placement.frame.minX, y: bounds.minY + placement.frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(placement.frame.size)
            )
        }
    }

    private func resolved(_ proposal: ProposedViewSize) -> CGFloat {
        guard let width = proposal.width, width > 0, width < .infinity else {
            return Self.assumedWidth
        }
        return width
    }

    // ── The walk ───────────────────────────────────────────────────────────

    /// One subview's resolved position.
    private struct Placement {
        let index: Int
        var frame: CGRect
    }

    /// Every subview's position, and the size they add up to.
    ///
    /// A named type rather than the `(placements:size:)` tuple it replaced: the
    /// tuple pushed the signature past `swift-format`'s line length, which then
    /// moved the opening brace onto its own line, which `opening_brace` rejects.
    /// Shortening the declaration settles that without either tool having to be
    /// overruled — which is the procedure `.swiftlint.yml` describes.
    private struct Flow {
        let placements: [Placement]
        let size: CGSize
    }

    /// Wrap every subview into lines and report where each one goes.
    ///
    /// Two passes over the same data rather than one: the vertical centring of a
    /// line cannot be decided until the tallest thing on it is known, and the
    /// tallest thing on it is not known until the line is closed.
    private func flow(subviews: Subviews, width: CGFloat) -> Flow {
        guard !subviews.isEmpty else { return Flow(placements: [], size: .zero) }

        var placements: [Placement] = []
        var lineStart = 0
        var cursor: CGFloat = 0
        var top: CGFloat = 0
        var lineHeight: CGFloat = 0
        let lastIndex = subviews.count - 1

        /// Centre everything on the open line and start a new one.
        func closeLine() {
            for position in lineStart..<placements.count {
                let slack = (lineHeight - placements[position].frame.height) / 2
                placements[position].frame.origin.y += slack
            }
            lineStart = placements.count
            top += lineHeight + lineSpacing
            cursor = 0
            lineHeight = 0
        }

        for index in 0..<subviews.count {
            let isEntry = index == lastIndex
            var size = subviews[index].sizeThatFits(.unspecified)

            if isEntry {
                if cursor > 0, width - cursor < minimumEntryWidth { closeLine() }
                let available = max(width - cursor, minimumEntryWidth)
                size = subviews[index].sizeThatFits(
                    ProposedViewSize(width: available, height: nil))
                size.width = available
            } else {
                // A name longer than the whole row is truncated by its own
                // `lineLimit`, not allowed to widen the control past its column.
                size.width = min(size.width, width)
                if cursor > 0, cursor + size.width > width { closeLine() }
            }

            placements.append(
                Placement(
                    index: index,
                    frame: CGRect(x: cursor, y: top, width: size.width, height: size.height)))
            cursor += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }

        // The final line is centred but does not open another, so its trailing
        // `lineSpacing` must not reach the reported height.
        for position in lineStart..<placements.count {
            let slack = (lineHeight - placements[position].frame.height) / 2
            placements[position].frame.origin.y += slack
        }
        return Flow(
            placements: placements, size: CGSize(width: width, height: top + lineHeight))
    }
}
