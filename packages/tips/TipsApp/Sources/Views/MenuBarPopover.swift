import SwiftUI

/// Popover content shown when clicking the menu bar icon.
struct MenuBarPopover: View {
    let appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let app = appState.currentApp {
                appHeader(app)
                Divider()
                tipContent(app)
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
    private func appHeader(_ app: TipApp) -> some View {
        HStack(spacing: 10) {
            Image(systemName: app.icon)
                .font(.title2)
                .foregroundStyle(app.color)
            VStack(alignment: .leading, spacing: 2) {
                Text("Today's App")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(app.name)
                    .font(.title3.bold())
            }
            Spacer()
        }
    }

    @ViewBuilder
    private func tipContent(_ app: TipApp) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(app.sections) { section in
                    TipSectionView(section: section)
                }
            }
        }
        .frame(maxHeight: 300)
    }

    private var footer: some View {
        HStack {
            Button {
                appState.showPreviousApp()
            } label: {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.borderless)

            Button {
                appState.showNextApp()
            } label: {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.borderless)

            Spacer()

            Button("Browse All") {
                openBrowseWindow()
            }

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
        if let url = URL(string: "tips://browse") {
            NSWorkspace.shared.open(url)
        }
        // Fallback: use environment openWindow when available
    }
}
