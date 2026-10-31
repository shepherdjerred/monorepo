import SwiftUI

/// Compact intrinsic chips wrap as complete controls; long text can grow vertically.
internal struct FacetChipLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width.flatMap { $0.isFinite ? $0 : nil } ?? 320
        let boxes = frames(subviews, width: width)
        return CGSize(width: width, height: boxes.map(\.maxY).max() ?? 0)
    }
    func placeSubviews(
        in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
    ) {
        let boxes = frames(subviews, width: bounds.width)
        for index in subviews.indices {
            subviews[index].place(
                at: CGPoint(
                    x: bounds.minX + boxes[index].minX,
                    y: bounds.minY + boxes[index].minY), anchor: .topLeading,
                proposal: ProposedViewSize(boxes[index].size))
        }
    }
    private func frames(_ subviews: Subviews, width: CGFloat) -> [CGRect] {
        var boxes: [CGRect] = []
        var left: CGFloat = 0
        var top: CGFloat = 0
        var lineHeight: CGFloat = 0
        for view in subviews {
            let ideal = view.sizeThatFits(.unspecified)
            let size = view.sizeThatFits(
                ProposedViewSize(width: min(width, ideal.width), height: nil))
            if left > 0, left + size.width > width {
                top += lineHeight + spacing
                left = 0
                lineHeight = 0
            }
            boxes.append(CGRect(origin: CGPoint(x: left, y: top), size: size))
            left += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        return boxes
    }
}
