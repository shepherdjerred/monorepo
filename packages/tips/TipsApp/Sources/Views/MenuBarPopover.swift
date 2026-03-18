import AppKit
import SwiftUI

/// Popover content shown when clicking the menu bar icon.
struct MenuBarPopover: View {

    @Bindable var appState: AppState

    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let tip = appState.currentTip {
                tipHeader(tip)
                Divider()
                tipBody(tip)
                Divider()
                footer
            } else {
                emptyState
            }
        }
        .padding()
        .frame(width: 320)
    }

    // MARK: - Subviews

    @ViewBuilder
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
        }
    }

    @ViewBuilder
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

    private var footer: some View {
        HStack {
            Button {
                appState.showPreviousTip()
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.borderless)
            .disabled(appState.allTips.isEmpty)

            Button {
                appState.showNextTip()
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.borderless)
            .disabled(appState.allTips.isEmpty)

            Spacer()

            Button("Browse All") {
                openBrowseWindow()
            }
            .disabled(appState.apps.isEmpty)

            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
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

    // MARK: - Actions

    private func openBrowseWindow() {
        if let tip = appState.currentTip {
            let appId = tip.appName.lowercased().replacingOccurrences(of: " ", with: "-")
            appState.selectedAppId = appId
        }

        NSApplication.shared.setActivationPolicy(.regular)
        openWindow(id: "browse")
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
}
