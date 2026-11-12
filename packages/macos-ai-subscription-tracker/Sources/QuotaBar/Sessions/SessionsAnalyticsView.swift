import Charts
import QuotaBarCore
import SwiftUI

/// Usage over the selected time range: daily cost and tokens, breakdowns by
/// model, agent, project, and machine, and the most-used tools.
struct SessionsAnalyticsView: View {
  let model: SessionsModel

  var body: some View {
    Group {
      if let analytics = model.analytics {
        ScrollView {
          AnalyticsContent(analytics: analytics)
            .padding(20)
            .opacity(model.analyticsPhase == .loading ? 0.6 : 1)
        }
        .overlay(alignment: .top) {
          if let error = model.analyticsPhase.error {
            Label(error.localizedDescription, systemImage: "exclamationmark.triangle")
              .font(.caption)
              .padding(8)
              .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
              .padding(8)
          }
        }
      } else if let error = model.analyticsPhase.error {
        HistoryErrorView(error: error)
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .task(id: model.range) { await model.loadAnalytics() }
  }
}

private struct AnalyticsContent: View {
  let analytics: SessionsAnalytics

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack(spacing: 32) {
        SessionsStat(title: "Estimated cost") { CostText(usage: analytics.total) }
        SessionsStat(title: "Tokens") {
          Text(HistoryFormat.tokens(analytics.total.totalTokens)).monospacedDigit()
        }
        SessionsStat(title: "Active days") { Text("\(analytics.daily.count)").monospacedDigit() }
        Spacer()
        Text(analytics.range.label).font(.caption).foregroundStyle(.secondary)
      }
      if analytics.daily.isEmpty {
        ContentUnavailableView(
          "No usage", systemImage: "chart.bar",
          description: Text("No session reported token usage in this range."))
      } else {
        ChartCard(title: "Daily cost") { DailyCostChart(points: analytics.daily) }
        ChartCard(title: "Daily tokens") { DailyTokensChart(points: analytics.daily) }
        LazyVGrid(
          columns: [
            GridItem(.flexible(), spacing: 20, alignment: .top),
            GridItem(.flexible(), alignment: .top),
          ],
          alignment: .leading, spacing: 20
        ) {
          breakdown("Cost by model", analytics.byModel) { $0 ?? "Unknown model" }
          breakdown("Cost by agent", analytics.bySource) { key in
            key.flatMap(HistorySource.init(rawValue:))?.displayName ?? key ?? "Unknown agent"
          }
          breakdown("Cost by project", analytics.byWorkspace) { key in
            key.map(HistoryFormat.workspaceName) ?? "No project"
          }
          breakdown("Cost by machine", analytics.byMachine) { HistoryFormat.machine($0) }
        }
      }
      // Tool calls are indexed apart from usage, so agents that record no
      // usage (Conductor) still show here.
      ChartCard(title: "Top tools") {
        BreakdownChart(
          bars: analytics.tools.enumerated().map { index, row in
            BreakdownBar(
              id: index, label: row.name, value: Double(row.calls),
              valueText: "\(row.calls) calls · \(row.sessions) sessions")
          },
          emptyText: "No tool calls")
      }
    }
  }

  private func breakdown(
    _ title: String, _ rows: [HistoryUsageRow], label: (String?) -> String
  ) -> some View {
    ChartCard(title: title) {
      BreakdownChart(
        bars: rows.prefix(10).enumerated().map { index, row in
          BreakdownBar(
            id: index, label: label(row.key), value: row.usage.costUSD,
            valueText: HistoryFormat.cost(row.usage), detail: row.key)
        })
    }
  }
}

private struct ChartCard<Content: View>: View {
  let title: String
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.headline)
      content
    }
  }
}

private struct DailyCostChart: View {
  let points: [HistoryDailyPoint]

  var body: some View {
    Chart(points) { point in
      BarMark(
        x: .value("Day", point.day, unit: .day),
        y: .value("Cost", point.usage.costUSD)
      )
      .foregroundStyle(Color.accentColor.gradient)
    }
    .chartXAxis { dayAxis }
    .chartYAxis {
      AxisMarks(position: .trailing) { value in
        AxisGridLine(stroke: BrimChartStyle.gridLine).foregroundStyle(BrimChartStyle.gridColor)
        AxisValueLabel {
          if let amount = value.as(Double.self) { Text(HistoryFormat.dollars(amount)) }
        }
      }
    }
    .chartPlotStyle { $0.brimPlotArea() }
    .frame(height: 200)
    .accessibilityLabel("Estimated cost per day")
  }
}

private struct DailyTokensChart: View {
  let points: [HistoryDailyPoint]

  var body: some View {
    Chart {
      ForEach(points) { point in
        ForEach(segments(point.usage), id: \.0) { kind, count in
          BarMark(x: .value("Day", point.day, unit: .day), y: .value("Tokens", count))
            .foregroundStyle(by: .value("Type", kind))
        }
      }
    }
    .chartXAxis { dayAxis }
    .chartYAxis {
      AxisMarks(position: .trailing) { value in
        AxisGridLine(stroke: BrimChartStyle.gridLine).foregroundStyle(BrimChartStyle.gridColor)
        AxisValueLabel {
          if let count = value.as(Int.self) { Text(HistoryFormat.tokens(count)) }
        }
      }
    }
    .chartLegend(position: .top, alignment: .leading)
    .chartPlotStyle { $0.brimPlotArea() }
    .frame(height: 220)
    .accessibilityLabel("Tokens per day by type")
  }

  private func segments(_ usage: HistoryUsage) -> [(String, Int)] {
    [
      ("Input", usage.inputTokens), ("Output", usage.outputTokens),
      ("Cache read", usage.cacheReadTokens), ("Cache write", usage.cacheCreationTokens),
    ]
  }
}

private var dayAxis: some AxisContent {
  AxisMarks(values: .automatic(desiredCount: 6)) { _ in
    AxisGridLine(stroke: BrimChartStyle.gridLine).foregroundStyle(BrimChartStyle.gridColor)
    AxisTick(stroke: BrimChartStyle.gridLine).foregroundStyle(BrimChartStyle.tickColor)
    AxisValueLabel(format: .dateTime.month(.abbreviated).day())
  }
}

private struct BreakdownBar: Identifiable {
  let id: Int
  let label: String
  /// The bar's length relative to the largest bar.
  let value: Double
  let valueText: String
  var detail: String?
}

/// Ranked horizontal bars with the label beside each bar, so long model
/// and project names stay readable at any width.
private struct BreakdownChart: View {
  let bars: [BreakdownBar]
  var emptyText = "No usage"

  var body: some View {
    if bars.isEmpty {
      Text(emptyText).font(.caption).foregroundStyle(.secondary)
    } else {
      let largest = max(bars.map(\.value).max() ?? 0, .leastNonzeroMagnitude)
      Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 7) {
        ForEach(bars) { bar in
          GridRow {
            Text(bar.label)
              .lineLimit(1)
              .truncationMode(.middle)
              .frame(width: 150, alignment: .leading)
              .help(bar.detail ?? bar.label)
            GeometryReader { proxy in
              Capsule()
                .fill(Color.accentColor.gradient)
                .frame(width: max(2, proxy.size.width * bar.value / largest))
            }
            .frame(height: 8)
            Text(bar.valueText)
              .monospacedDigit()
              .foregroundStyle(.secondary)
              .gridColumnAlignment(.trailing)
          }
          .font(.caption)
        }
      }
      .padding(10)
      .brimPlotArea()
      .accessibilityElement(children: .combine)
    }
  }
}
