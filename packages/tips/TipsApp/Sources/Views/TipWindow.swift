import AppKit
import SwiftUI

/// Standalone window displaying the current daily tip.
struct TipWindow: View {
    // MARK: Internal

    @Bindable var appState: AppState

    var body: some View {
        Group {
            if let tip = appState.currentTip {
                VStack(alignment: .leading, spacing: 16) {
                    self.header(tip)
                    Divider()
                    self.tipContent(tip)
                    Spacer()
                    Divider()
                    self.footer(tip)
                }
                .padding()
            } else {
                ContentUnavailableView(
                    "No Tips",
                    systemImage: "lightbulb.slash",
                    description: Text("Add markdown files to the content directory.")
                )
            }
        }
        .frame(minWidth: 380, minHeight: 260)
        .navigationTitle("Tip")
    }

    // MARK: Private

    private var navigationButtons: some View {
        Group {
            Button { self.appState.showPreviousTip() } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.borderless)
            .disabled(self.appState.allTips.isEmpty)
            .help("Previous tip")

            Button { self.appState.showNextTip() } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.borderless)
            .disabled(self.appState.allTips.isEmpty)
            .help("Next tip")

            Button { self.appState.showRandomTip() } label: {
                Image(systemName: "shuffle")
            }
            .buttonStyle(.borderless)
            .disabled(self.appState.allTips.isEmpty)
            .help("Random tip")
        }
    }

    private var tipCounter: some View {
        Text("\(self.appState.currentTipIndex + 1) of \(self.appState.allTips.count)")
            .font(.caption)
            .foregroundStyle(.secondary)
            .monospacedDigit()
    }

    // MARK: - Header

    private func header(_ tip: FlatTip) -> some View {
        HStack(spacing: 10) {
            Image(systemName: tip.appIcon)
                .font(.title)
                .foregroundStyle(tip.appColor)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(tip.appName)
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Text(tip.category)
                    .font(.title2.bold())
            }

            Spacer()

            Button {
                self.appState.toggleCurrentTipFavorite()
            } label: {
                Image(
                    systemName: self.appState.reviewManager.isFavorite(tip.id) ? "star.fill" : "star"
                )
                .font(.title3)
                .foregroundStyle(
                    self.appState.reviewManager.isFavorite(tip.id) ? .yellow : .secondary
                )
            }
            .buttonStyle(.borderless)
            .help("Favorite")
        }
    }

    // MARK: - Tip Content

    private func tipContent(_ tip: FlatTip) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if let shortcut = tip.shortcut {
                KeyCapView(shortcut: shortcut)
                    .font(.system(.body, design: .monospaced, weight: .medium))
            }
            Text(tip.text)
                .font(.title3)
                .foregroundStyle(.primary)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Footer

    private func footer(_ tip: FlatTip) -> some View {
        HStack {
            self.navigationButtons
            Spacer()
            self.tipCounter
            Spacer()
            self.reviewButtons(tip)
        }
    }

    private func reviewButtons(_ tip: FlatTip) -> some View {
        Group {
            Button("Learned") { self.appState.markCurrentTipLearned() }
                .buttonStyle(.borderless)
                .help("Mark as learned — remove from rotation")

            Button("Later") { self.appState.markCurrentTipShowAgain() }
                .buttonStyle(.borderless)
                .help("Show again later")

            Button { self.copyTip(tip) } label: {
                Image(systemName: "doc.on.doc")
            }
            .buttonStyle(.borderless)
            .help("Copy tip")
        }
    }

    private func copyTip(_ tip: FlatTip) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(tip.formattedText, forType: .string)
    }
}
