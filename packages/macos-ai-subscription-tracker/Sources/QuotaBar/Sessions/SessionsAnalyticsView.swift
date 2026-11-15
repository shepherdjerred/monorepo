import Charts
import QuotaBarCore
import SwiftUI

/// Usage over the selected time range: cost and tokens per day, week, or
/// month stacked by agent, model, project, or machine; the last three days'
/// 5-hour blocks; breakdowns by model, agent, project, and machine; and the
/// most-used tools.
struct SessionsAnalyticsView: View {
  @Bindable var model: SessionsModel

  var body: some View {
    Group {
      if model.analytics != nil || model.periodChart != nil {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            AnalyticsHeader(model: model)
            if let chart = model.periodChart {
              PeriodCharts(chart: chart)
                .opacity(model.periodChartPhase == .loading ? 0.6 : 1)
            }
            if let analytics = model.analytics {
              AnalyticsContent(analytics: analytics)
                .opacity(model.analyticsPhase == .loading ? 0.6 : 1)
            }
          }
          .padding(20)
        }
        .overlay(alignment: .top) {
          if let error = model.analyticsPhase.error ?? model.periodChartPhase.error {
            Label(error.localizedDescription, systemImage: "exclamationmark.triangle")
              .font(.caption)
              .padding(8)
              .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
              .padding(8)
          }
        }
      } else if let error = model.analyticsPhase.error ?? model.periodChartPhase.error {
        HistoryErrorView(error: error)
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .task(id: model.range) { await model.loadAnalytics() }
    .task(id: model.periodQuery) { await model.loadPeriodChart() }
  }
}

/// Totals for the range, and the period and breakdown pickers.
private struct AnalyticsHeader: View {
  @Bindable var model: SessionsModel

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 32) {
        if let chart = model.periodChart {
          SessionsStat(title: "Estimated cost") { CostText(usage: chart.total.usage) }
          SessionsStat(title: "Tokens") {
            Text(HistoryFormat.tokens(chart.total.totalTokens)).monospacedDigit()
          }
          SessionsStat(title: "Active \(chart.period.rawValue)s") {
            Text("\(chart.activePeriods)").monospacedDigit()
          }
        }
        Spacer()
        Text(model.range.label).font(.caption).foregroundStyle(.secondary)
      }
      HStack(spacing: 16) {
        Picker("Period", selection: $model.usagePeriod) {
          ForEach(HistoryUsagePeriod.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(width: 220)
        .help("Bucket usage into calendar days, weeks, or months")
        Picker("Stack by", selection: $model.usageDimension) {
          ForEach(HistoryUsageDimension.allCases) { Text($0.label).tag($0) }
        }
        .pickerStyle(.menu)
        .fixedSize()
        .help("What the cost and token bars are stacked by")
        Spacer()
      }
      if let unpriced = model.periodChart?.unpricedModels, !unpriced.isEmpty {
        Label(
          "No list price for \(unpriced.joined(separator: ", ")); costs that include "
            + (unpriced.count == 1 ? "it" : "them") + " are lower bounds.",
          systemImage: "info.circle"
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }
    }
  }
}

private struct AnalyticsContent: View {
  let analytics: SessionsAnalytics

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      ChartCard(title: "5-hour blocks · last 3 days") {
        BlocksTimeline(report: analytics.blocks)
      }
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

/// Cost and tokens per period, stacked by the selected dimension.
private struct PeriodCharts: View {
  let chart: UsagePeriodChart

  var body: some View {
    if chart.points.isEmpty {
      ContentUnavailableView(
        "No usage", systemImage: "chart.bar",
        description: Text("No session reported token usage in this range."))
    } else {
      let per = "per \(chart.period.rawValue) by \(chart.dimension.rawValue)"
      ChartCard(title: "Cost \(per)") {
        StackedPeriodChart(chart: chart, metric: .cost)
      }
      ChartCard(title: "Tokens \(per)") {
        StackedPeriodChart(chart: chart, metric: .tokens)
      }
    }
  }
}

private struct StackedPeriodChart: View {
  enum Metric {
    case cost
    case tokens
  }

  let chart: UsagePeriodChart
  let metric: Metric

  var body: some View {
    Chart(chart.points) { point in
      BarMark(
        x: .value("Period", point.periodStart, unit: unit),
        y: .value(metric == .cost ? "Cost" : "Tokens", value(point))
      )
      .foregroundStyle(by: .value(chart.dimension.label, point.series))
    }
    .chartForegroundStyleScale(domain: chart.series)
    .chartXAxis {
      AxisMarks(values: .automatic(desiredCount: 6)) { _ in
        AxisGridLine(stroke: BrimChartStyle.gridLine).foregroundStyle(BrimChartStyle.gridColor)
        AxisTick(stroke: BrimChartStyle.gridLine).foregroundStyle(BrimChartStyle.tickColor)
        AxisValueLabel(format: dateFormat)
      }
    }
    .chartYAxis {
      AxisMarks(position: .trailing) { value in
        AxisGridLine(stroke: BrimChartStyle.gridLine).foregroundStyle(BrimChartStyle.gridColor)
        AxisValueLabel {
          if let amount = value.as(Double.self) {
            Text(
              metric == .cost ? HistoryFormat.dollars(amount) : HistoryFormat.tokens(Int(amount)))
          }
        }
      }
    }
    .chartLegend(position: .top, alignment: .leading)
    .chartPlotStyle { $0.brimPlotArea() }
    .frame(height: metric == .cost ? 220 : 200)
    .accessibilityLabel(
      "\(metric == .cost ? "Estimated cost" : "Tokens") per \(chart.period.rawValue) by "
        + chart.dimension.rawValue)
  }

  private func value(_ point: UsagePeriodChart.Point) -> Double {
    metric == .cost ? point.costUSD : Double(point.tokens)
  }

  private var unit: Calendar.Component {
    switch chart.period {
    case .day: .day
    case .week: .weekOfYear
    case .month: .month
    }
  }

  private var dateFormat: Date.FormatStyle {
    chart.period == .month
      ? .dateTime.month(.abbreviated).year(.twoDigits) : .dateTime.month(.abbreviated).day()
  }
}

/// Every agent's 5-hour blocks on one time axis, with the active blocks
/// highlighted and projected to their end.
private struct BlocksTimeline: View {
  let report: HistoryBlocksReport

  var body: some View {
    if report.blocks.isEmpty {
      Text("No usage blocks in the last 3 days").font(.caption).foregroundStyle(.secondary)
    } else {
      VStack(alignment: .leading, spacing: 8) {
        Chart {
          ForEach(report.blocks) { block in
            BarMark(
              xStart: .value("Start", block.start),
              xEnd: .value("End", block.isActive ? min(report.now, block.end) : block.end),
              y: .value("Agent", block.agent.displayName),
              height: .ratio(0.45)
            )
            .foregroundStyle(block.isActive ? Color.accentColor : Color.secondary.opacity(0.35))
            .annotation(
              position: .top, alignment: .leading, spacing: 1,
              overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
            ) {
              Text(HistoryFormat.estimate(block.measured.usage))
                .font(.caption2.monospacedDigit())
                .foregroundStyle(block.isActive ? Color.accentColor : Color.secondary)
            }
            if block.isActive, report.now < block.end {
              BarMark(
                xStart: .value("Start", report.now),
                xEnd: .value("End", block.end),
                y: .value("Agent", block.agent.displayName),
                height: .ratio(0.45)
              )
              .foregroundStyle(Color.accentColor.opacity(0.25))
            }
          }
          RuleMark(x: .value("Now", report.now))
            .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            .foregroundStyle(.secondary)
        }
        .chartXScale(domain: domainStart...domainEnd)
        .chartYAxis {
          AxisMarks(position: .leading) { _ in
            AxisValueLabel()
          }
        }
        .chartXAxis {
          AxisMarks(values: .stride(by: .hour, count: 12)) { _ in
            AxisGridLine(stroke: BrimChartStyle.gridLine).foregroundStyle(BrimChartStyle.gridColor)
            AxisTick(stroke: BrimChartStyle.gridLine).foregroundStyle(BrimChartStyle.tickColor)
            AxisValueLabel(format: .dateTime.weekday(.abbreviated).hour())
          }
        }
        .chartPlotStyle { $0.brimPlotArea() }
        .frame(height: CGFloat(agentCount) * 36 + 30)
        .accessibilityLabel("Five-hour usage blocks per agent over the last three days")
        ForEach(report.blocks.filter(\.isActive)) { block in
          Label(block.timelineSummary(at: report.now), systemImage: "flame")
            .font(.caption)
            .monospacedDigit()
            .help(block.helpText)
        }
      }
    }
  }

  private var agentCount: Int { Set(report.blocks.map(\.agent)).count }

  private var domainStart: Date {
    report.since ?? report.blocks.map(\.start).min() ?? report.now
  }

  private var domainEnd: Date {
    max(report.now, report.blocks.map(\.end).max() ?? report.now)
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
