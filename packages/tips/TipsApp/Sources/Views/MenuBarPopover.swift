import AppKit
import SwiftUI

/// Popover content shown when clicking the menu bar icon.
struct MenuBarPopover: View {
    // MARK: Internal

    @Bindable var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let tip = appState.currentTip {
                self.tipHeader(tip)
                Divider()
                self.tipBody(tip)
                Divider()
                self.footer
            } else {
                self.emptyState
            }
        }
        .padding()
        .frame(width: 320)
    }

    // MARK: Private

    @Environment(\.openWindow) private var openWindow

    private var footer: some View {
        VStack(spacing: 8) {
            self.navigationRow
            self.reviewRow
            self.actionRow
        }
    }

    private var navigationRow: some View {
        HStack {
            Button { self.appState.showPreviousTip() } label: { Image(systemName: "chevron.left") }
                .buttonStyle(.borderless)
                .keyboardShortcut(.leftArrow, modifiers: [])
                .disabled(self.appState.allTips.isEmpty)

            Spacer()

            if !self.appState.allTips.isEmpty {
                Text("\(self.appState.currentTipIndex + 1) of \(self.appState.allTips.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            Spacer()

            Button { self.appState.showNextTip() } label: { Image(systemName: "chevron.right") }
                .buttonStyle(.borderless)
                .keyboardShortcut(.rightArrow, modifiers: [])
                .disabled(self.appState.allTips.isEmpty)

            Button { self.appState.showRandomTip() } label: { Image(systemName: "shuffle") }
                .buttonStyle(.borderless)
                .disabled(self.appState.allTips.isEmpty)
                .help("Random tip")

            Button { self.copyCurrentTip() } label: { Image(systemName: "doc.on.doc") }
                .buttonStyle(.borderless)
                .disabled(self.appState.currentTip == nil)
                .help("Copy tip to clipboard")
        }
    }

    private var reviewRow: some View {
        HStack {
            Button { self.appState.markCurrentTipLearned() } label: {
                Label("Got it", systemImage: "checkmark.circle")
            }
            .buttonStyle(.borderless)
            .disabled(self.appState.currentTip == nil)
            .help("Mark as learned — remove from rotation")

            Button { self.appState.markCurrentTipShowAgain() } label: {
                Label("Show again", systemImage: "arrow.counterclockwise")
            }
            .buttonStyle(.borderless)
            .disabled(self.appState.currentTip == nil)
            .help("Show again later")

            Spacer()
        }
    }

    private var actionRow: some View {
        HStack {
            Button("Browse All") { self.openBrowseWindow() }
                .disabled(self.appState.apps.isEmpty)
            Spacer()
            Button("Quit") { NSApplication.shared.terminate(nil) }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "lightbulb.slash")
                .font(.largeTitle)
                .foregroundStyle(.secondary)

            Text("No tips found")
                .font(.headline)

            Text("Add markdown files to the content directory.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
    }

    // MARK: - Subviews

    private func tipHeader(_ tip: FlatTip) -> some View {
        HStack(spacing: 10) {
            Image(systemName: tip.appIcon)
                .font(.title2)
                .foregroundStyle(tip.appColor)

            VStack(alignment: .leading, spacing: 2) {
                Text(tip.appName)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(tip.category)
                    .font(.title3.bold())
            }

            Spacer()

            Button {
                self.appState.toggleCurrentTipFavorite()
            } label: {
                Image(systemName: self.appState.reviewManager.isFavorite(tip.id) ? "star.fill" : "star")
                    .foregroundStyle(self.appState.reviewManager.isFavorite(tip.id) ? .yellow : .secondary)
            }
            .buttonStyle(.borderless)
            .help("Favorite")
        }
    }

    private func tipBody(_ tip: FlatTip) -> some View {
        HStack(alignment: .top, spacing: 8) {
            if let shortcut = tip.shortcut {
                KeyCapView(shortcut: shortcut)
            }
            Text(tip.text)
                .font(.body)
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func copyCurrentTip() {
        guard let tip = appState.currentTip else {
            return
        }
        let text: String = if let shortcut = tip.shortcut {
            "\(shortcut) — \(tip.text)"
        } else {
            tip.text
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    private func openBrowseWindow() {
        if let tip = appState.currentTip {
            let appId = tip.appName.lowercased().replacingOccurrences(of: " ", with: "-")
            self.appState.selectedAppId = appId
        }

        NSApplication.shared.setActivationPolicy(.regular)
        self.openWindow(id: "browse")
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
}
