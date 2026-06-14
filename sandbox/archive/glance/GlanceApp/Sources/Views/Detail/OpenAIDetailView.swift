import Charts
import SwiftUI

/// Detail view showing OpenAI API cost and token usage breakdown.
struct OpenAIDetailView: View {
    // MARK: Internal

    let usage: OpenAIAPIUsage

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            self.costHeader
            self.tokenChart
            self.modelTable
        }
    }

    // MARK: Private

    private var costHeader: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(self.formatCurrency(self.usage.totalCost))
                    .font(.system(.title, design: .rounded, weight: .bold))
                    .monospacedDigit()
                let start = self.usage.billingPeriodStart
                let end = self.usage.billingPeriodEnd
                Text("\(start, format: .dateTime.month().day()) – \(end, format: .dateTime.month().day())")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    @ViewBuilder
    private var tokenChart: some View {
        if !self.usage.modelBreakdown.isEmpty {
            Text("Tokens by Model")
                .font(.headline)

            Chart(self.usage.modelBreakdown) { item in
                BarMark(
                    x: .value("Tokens", item.inputTokens + item.outputTokens),
                    y: .value("Model", item.model),
                )
                .foregroundStyle(.blue)
            }
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let intValue = value.as(Int.self) {
                            Text(self.formatNumber(intValue))
                        }
                    }
                }
            }
            .frame(height: min(CGFloat(self.usage.modelBreakdown.count) * 32 + 40, 200))
        }
    }

    @ViewBuilder
    private var modelTable: some View {
        if self.usage.modelBreakdown.isEmpty {
            Text("No usage this period.")
                .foregroundStyle(.secondary)
        } else {
            Table(self.usage.modelBreakdown) {
                TableColumn("Model") { model in
                    Text(model.model)
                        .fontWeight(.medium)
                }
                TableColumn("Input Tokens") { model in
                    Text(self.formatNumber(model.inputTokens))
                        .monospacedDigit()
                }
                .width(120)
                TableColumn("Output Tokens") { model in
                    Text(self.formatNumber(model.outputTokens))
                        .monospacedDigit()
                }
                .width(120)
                TableColumn("Requests") { model in
                    Text(self.formatNumber(model.requests))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .width(100)
            }
            .alternatingRowBackgrounds()
            .frame(minHeight: 200)
        }
    }

    private func formatCurrency(_ amount: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        return formatter.string(from: NSNumber(value: amount)) ?? "$\(amount)"
    }

    private func formatNumber(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}
