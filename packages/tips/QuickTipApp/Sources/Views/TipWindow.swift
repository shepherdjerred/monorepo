import AppKit
import SwiftUI

/// Standalone window displaying the current daily tip.
struct TipWindow: View {
    // MARK: Internal

    @Bindable var appState: AppState

    var body: some View {
        Group {
            if let tip = appState.currentTip {
                self.tipContent(tip)
            } else {
                ContentUnavailableView(
                    "No Tips",
                    systemImage: "lightbulb.slash",
                    description: Text("Add markdown files to the content directory.")
                )
            }
        }
        .frame(minWidth: 400, minHeight: 300)
        .toolbar {
            ToolbarItem(placement: .principal) {
                if let tip = self.appState.currentTip {
                    VStack(spacing: 1) {
                        Text(tip.appName)
                            .font(.headline)
                        Text("\(self.appState.currentTipIndex + 1) of \(self.appState.allTips.count)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                }
            }

            ToolbarItemGroup(placement: .primaryAction) {
                if let tip = self.appState.currentTip {
                    Button {
                        self.appState.toggleCurrentTipFavorite()
                    } label: {
                        Image(
                            systemName: self.appState.reviewManager.isFavorite(tip.id)
                                ? "star.fill" : "star"
                        )
                        .foregroundStyle(
                            self.appState.reviewManager.isFavorite(tip.id) ? .yellow : .secondary
                        )
                    }
                    .help("Favorite")

                    Button { self.copyTip(tip) } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .help("Copy tip")
                }
            }
        }
        .navigationTitle(self.appState.currentTip?.appName ?? "Tip")
    }

    // MARK: Private

    private func tipContent(_ tip: FlatTip) -> some View {
        VStack(spacing: 0) {
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(tip.appColor.opacity(0.15))

                HStack(spacing: 14) {
                    Image(systemName: tip.appIcon)
                        .font(.system(size: 32))
                        .foregroundStyle(tip.appColor)
                        .symbolRenderingMode(.hierarchical)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(tip.appName)
                            .font(.headline)
                            .foregroundStyle(.primary)
                        Text(tip.category)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text("\(self.appState.currentTipIndex + 1) of \(self.appState.allTips.count)")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .monospacedDigit()
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 20)
            }
            .frame(height: 100)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 10) {
                    if let shortcut = tip.shortcut {
                        KeyCapView(shortcut: shortcut)
                    }
                    Text(tip.text)
                        .font(.title3)
                        .textSelection(.enabled)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)

            Spacer()

            Divider()

            HStack {
                Button { self.appState.showPreviousTip() } label: {
                    Label("Prev", systemImage: "chevron.left")
                }
                .buttonStyle(.borderless)

                Spacer()

                Button("Later") { self.appState.markCurrentTipShowAgain() }
                    .buttonStyle(.bordered)

                Button("Learned") { self.appState.markCurrentTipLearned() }
                    .buttonStyle(.borderedProminent)

                Spacer()

                Button { self.appState.showNextTip() } label: {
                    Label("Next", systemImage: "chevron.right")
                }
                .buttonStyle(.borderless)
                .environment(\.layoutDirection, .rightToLeft)
            }
            .padding()
        }
    }

    private func copyTip(_ tip: FlatTip) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(tip.formattedText, forType: .string)
    }
}
