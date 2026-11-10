import SwiftUI

/// The plot area, grid, and tick styling shared by Brim's charts.
enum BrimChartStyle {
  static let gridLine = StrokeStyle(lineWidth: 0.5)
  static let gridColor = Color.secondary.opacity(0.16)
  static let tickColor = Color.secondary.opacity(0.35)
  static let plotBackground = Color.secondary.opacity(0.045)
  static let plotCornerRadius: CGFloat = 6
}

extension View {
  /// A faint rounded background behind a chart's plot area.
  func brimPlotArea() -> some View {
    background(BrimChartStyle.plotBackground)
      .clipShape(RoundedRectangle(cornerRadius: BrimChartStyle.plotCornerRadius))
  }
}
