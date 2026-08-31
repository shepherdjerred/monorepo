import Charts
import QuotaBarCore
import SwiftUI

struct UsageHistoryView: View {
  let samples: [UsageHistorySample]
  let visibleProviderIDs: Set<ProviderID>
  let date: Date
  @State private var selectedWindowKey: String?
  @State private var range: HistoryRange = .day

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if windows.isEmpty {
        emptyState
      } else {
        Picker("Quota window", selection: $selectedWindowKey) {
          ForEach(windows) { window in
            Text("\(window.provider.displayName) · \(window.label)").tag(Optional(window.id))
          }
        }
        .labelsHidden()
        .pickerStyle(.menu)

        Picker("History range", selection: $range) {
          ForEach(HistoryRange.allCases) { range in
            Text(range.label).tag(range)
          }
        }
        .pickerStyle(.segmented)

        if selectedSamples.count >= 2 {
          chart
          context
        } else {
          emptyState
        }
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .onAppear { selectDefaultWindowIfNeeded() }
    .onChange(of: samples) { _, _ in selectDefaultWindowIfNeeded() }
    .onChange(of: visibleProviderIDs) { _, _ in selectDefaultWindowIfNeeded() }
  }

  private var windows: [HistoryWindow] {
    var latest: [String: UsageHistorySample] = [:]
    for sample in samples where visibleProviderIDs.contains(sample.provider) {
      guard latest[sample.windowIDWithProvider]?.recordedAt ?? .distantPast < sample.recordedAt
      else { continue }
      latest[sample.windowIDWithProvider] = sample
    }
    return latest.values
      .map(HistoryWindow.init)
      .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
  }

  private var selectedSamples: [UsageHistorySample] {
    guard let selectedWindowKey else { return [] }
    let cutoff = date.addingTimeInterval(-range.duration)
    return samples.filter { sample in
      visibleProviderIDs.contains(sample.provider)
        && sample.windowIDWithProvider == selectedWindowKey
        && sample.recordedAt >= cutoff
    }
    .sorted { $0.recordedAt < $1.recordedAt }
  }

  private var chart: some View {
    Chart {
      ForEach(chartPoints) { point in
        AreaMark(
          x: .value("Time", point.sample.recordedAt),
          yStart: .value("Used", 0),
          yEnd: .value("Used", point.sample.usedPercent),
          series: .value("Quota cycle", point.cycle)
        )
        .interpolationMethod(.linear)
        .foregroundStyle(
          LinearGradient(
            colors: [Color.accentColor.opacity(0.18), Color.accentColor.opacity(0.015)],
            startPoint: .top,
            endPoint: .bottom
          )
        )

        LineMark(
          x: .value("Time", point.sample.recordedAt),
          y: .value("Used", point.sample.usedPercent),
          series: .value("Quota cycle", point.cycle)
        )
        .interpolationMethod(.linear)
        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        .foregroundStyle(Color.accentColor)
      }

      ForEach(resetMarkers) { marker in
        RuleMark(x: .value("Reset", marker.recordedAt))
          .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
          .foregroundStyle(Color.secondary.opacity(0.42))
      }

      if let current = selectedSamples.last {
        PointMark(
          x: .value("Current time", current.recordedAt),
          y: .value("Current usage", current.usedPercent)
        )
        .symbolSize(42)
        .foregroundStyle(Color.accentColor)
      }
    }
    .chartXScale(
      domain: date.addingTimeInterval(-range.duration)...date,
      range: .plotDimension(startPadding: 5, endPadding: 5)
    )
    .chartYScale(domain: 0...100)
    .chartXAxis {
      AxisMarks(values: .automatic(desiredCount: 3)) { _ in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
          .foregroundStyle(Color.secondary.opacity(0.16))
        AxisTick(stroke: StrokeStyle(lineWidth: 0.5))
          .foregroundStyle(Color.secondary.opacity(0.35))
        AxisValueLabel(format: range.axisFormat)
          .foregroundStyle(Color.secondary)
      }
    }
    .chartYAxis {
      AxisMarks(position: .trailing, values: [0, 25, 50, 75, 100]) { value in
        AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
          .foregroundStyle(Color.secondary.opacity(0.16))
        AxisValueLabel {
          if let percentage = value.as(Int.self) {
            Text("\(percentage)%")
          }
        }
        .foregroundStyle(Color.secondary)
      }
    }
    .chartPlotStyle { plotArea in
      plotArea
        .background(Color.secondary.opacity(0.045))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
    .frame(height: 220)
    .accessibilityLabel("Subscription usage history")
    .accessibilityValue(chartAccessibilityValue)
  }

  private var context: some View {
    HStack(spacing: 12) {
      if let current = selectedSamples.last {
        Label(
          "\(Int(current.usedPercent.rounded()))% used",
          systemImage: "gauge.with.dots.needle.50percent"
        )
        if !resetMarkers.isEmpty {
          Label(
            "\(resetMarkers.count) reset\(resetMarkers.count == 1 ? "" : "s")",
            systemImage: "arrow.counterclockwise"
          )
        }
        Spacer(minLength: 0)
        if let resetAt = current.resetAt {
          Text("Resets \(QuotaTimeFormatter.compactCountdown(to: resetAt, from: date))")
        }
      }
    }
    .font(.caption2)
    .foregroundStyle(.secondary)
    .monospacedDigit()
  }

  private var chartPoints: [HistoryChartPoint] {
    var cycle = 0
    var previous: UsageHistorySample?
    return selectedSamples.map { sample in
      let beginsCycle = previous.map { startsNewCycle(after: $0, current: sample) } ?? false
      if beginsCycle { cycle += 1 }
      previous = sample
      return HistoryChartPoint(sample: sample, cycle: cycle, beginsCycle: beginsCycle)
    }
  }

  private var resetMarkers: [HistoryResetMarker] {
    chartPoints.compactMap { point in
      guard point.beginsCycle else { return nil }
      return HistoryResetMarker(id: point.id, recordedAt: point.sample.recordedAt)
    }
  }

  private var chartAccessibilityValue: String {
    guard let first = selectedSamples.first, let current = selectedSamples.last else {
      return "No history"
    }
    let resetDescription =
      resetMarkers.isEmpty
      ? "no resets"
      : "\(resetMarkers.count) reset\(resetMarkers.count == 1 ? "" : "s")"
    return
      "Used percentage from \(Int(first.usedPercent.rounded())) to "
      + "\(Int(current.usedPercent.rounded())), \(resetDescription), over \(range.accessibilityLabel)."
  }

  private func startsNewCycle(
    after previous: UsageHistorySample,
    current: UsageHistorySample
  ) -> Bool {
    guard current.usedPercent < previous.usedPercent,
      let previousResetAt = previous.resetAt,
      let currentResetAt = current.resetAt
    else { return false }
    return currentResetAt.timeIntervalSince(previousResetAt) > 60
  }

  private var emptyState: some View {
    ContentUnavailableView(
      "No history yet",
      systemImage: "chart.xyaxis.line",
      description: Text(
        "Brim graphs successful refreshes after it is updated. At least two samples are needed.")
    )
    .frame(maxWidth: .infinity, minHeight: 260)
  }

  private func selectDefaultWindowIfNeeded() {
    guard selectedWindowKey == nil || !windows.contains(where: { $0.id == selectedWindowKey })
    else {
      return
    }
    selectedWindowKey = windows.first?.id
  }
}

private enum HistoryRange: CaseIterable, Identifiable {
  case day
  case week
  case month

  var id: Self { self }
  var duration: TimeInterval {
    switch self {
    case .day: 24 * 60 * 60
    case .week: 7 * 24 * 60 * 60
    case .month: 30 * 24 * 60 * 60
    }
  }

  var label: String {
    switch self {
    case .day: "24h"
    case .week: "7d"
    case .month: "30d"
    }
  }

  var axisFormat: Date.FormatStyle {
    switch self {
    case .day: .dateTime.hour(.twoDigits(amPM: .abbreviated)).minute(.twoDigits)
    case .week, .month: .dateTime.month(.abbreviated).day()
    }
  }

  var accessibilityLabel: String {
    switch self {
    case .day: "24 hours"
    case .week: "7 days"
    case .month: "30 days"
    }
  }
}

private struct HistoryChartPoint: Identifiable {
  let sample: UsageHistorySample
  let cycle: Int
  let beginsCycle: Bool

  var id: String { sample.id }
}

private struct HistoryResetMarker: Identifiable {
  let id: String
  let recordedAt: Date
}

private struct HistoryWindow: Identifiable {
  let provider: ProviderID
  let id: String
  let label: String

  init(sample: UsageHistorySample) {
    provider = sample.provider
    id = sample.windowIDWithProvider
    label = sample.label
  }

  var title: String { "\(provider.displayName) · \(label)" }
}

private extension UsageHistorySample {
  var windowIDWithProvider: String { "\(provider.rawValue):\(windowID)" }
}
