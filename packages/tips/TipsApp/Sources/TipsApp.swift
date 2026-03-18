import SwiftUI

@main
struct TipsApp: App {

    @State private var appState: AppState

    var body: some Scene {
        MenuBarExtra("Tips", systemImage: "lightbulb.fill") {
            MenuBarPopover(appState: appState)
        }
        .menuBarExtraStyle(.window)

        Window("Browse Tips", id: "browse") {
            BrowseWindow(appState: appState)
        }
        .defaultSize(width: 700, height: 500)
    }

    init() {
        _appState = State(initialValue: AppState(tipsDirectory: Self.findContentDirectory()))
    }

    private static func findContentDirectory() -> URL {
        if let resourceURL = Bundle.module.resourceURL {
            let bundledContentURL = resourceURL.appendingPathComponent("content", isDirectory: true)

            if containsMarkdownFiles(at: bundledContentURL) {
                return bundledContentURL
            }

            if containsMarkdownFiles(at: resourceURL) {
                return resourceURL
            }
        }

        let executableURL = Bundle.main.executableURL
            ?? URL(fileURLWithPath: ProcessInfo.processInfo.arguments[0])
        let possiblePaths = [
            executableURL
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .deletingLastPathComponent()
                .appendingPathComponent("content"),
            executableURL
                .deletingLastPathComponent()
                .appendingPathComponent("content"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .appendingPathComponent("content"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                .deletingLastPathComponent()
                .appendingPathComponent("content"),
        ]

        for path in possiblePaths where FileManager.default.fileExists(atPath: path.path) {
            return path
        }

        return possiblePaths[0]
    }

    private static func containsMarkdownFiles(at directory: URL) -> Bool {
        guard let fileURLs = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else {
            return false
        }

        return fileURLs.contains { $0.pathExtension == "md" }
    }
}
