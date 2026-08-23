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
      sample.windowIDWithProvider == selectedWindowKey && sample.recordedAt >= cutoff
    }
    .sorted { $0.recordedAt < $1.recordedAt }
  }

  private var chart: some View {
    Chart(selectedSamples) { sample in
      LineMark(
        x: .value("Time", sample.recordedAt),
        y: .value("Used", sample.usedPercent)
      )
      .interpolationMethod(.catmullRom)
      .foregroundStyle(Color.accentColor)
      PointMark(
        x: .value("Time", sample.recordedAt),
        y: .value("Used", sample.usedPercent)
      )
      .foregroundStyle(Color.accentColor)
    }
    .chartYScale(domain: 0...100)
    .chartYAxisLabel("Used %")
    .chartXAxis {
      AxisMarks(values: .automatic(desiredCount: 4))
    }
    .frame(height: 220)
    .accessibilityLabel("Subscription usage history graph")
  }

  private var context: some View {
    HStack {
      if let current = selectedSamples.last {
        Text("Current: \(Int(current.usedPercent.rounded()))% used")
        if let resetAt = current.resetAt {
          Spacer()
          Text("Resets \(QuotaTimeFormatter.compactCountdown(to: resetAt, from: date))")
        }
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .monospacedDigit()
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
