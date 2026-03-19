import AppKit
import CoreSpotlight
import os
import SwiftUI
import UserNotifications

@main
struct TipsApp: App {
    // MARK: Lifecycle

    init() {
        Logger.lifecycle.info("TipsApp initializing")
        let state = AppState(tipsDirectory: Self.findContentDirectory())
        _appState = State(initialValue: state)
        TipsAppContext.shared = state

        if NotificationManager.isAvailable {
            UNUserNotificationCenter.current().delegate = self.notificationDelegate

            Task { @MainActor in
                let granted = await NotificationManager.requestPermission()
                if granted, let tip = state.currentTip {
                    NotificationManager.scheduleDailyNotification(tip: tip)
                }
            }
        }
        Logger.lifecycle.info("TipsApp initialized with \(state.allTips.count) tips")
    }

    // MARK: Internal

    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        MenuBarExtra("Tips", systemImage: self.appState.currentTip != nil ? "lightbulb.fill" : "lightbulb") {
            self.menuContent
        }
        .menuBarExtraStyle(.menu)

        Window("Tip", id: "tip") {
            TipWindow(appState: self.appState)
                .onAppear { self.windowOpened() }
                .onDisappear { self.windowClosed() }
        }
        .defaultSize(width: 420, height: 300)

        Window("Browse Tips", id: "browse") {
            BrowseWindow(appState: self.appState)
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    if let identifier = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String {
                        let appId = identifier.components(separatedBy: "-").prefix(2).joined(separator: "-")
                        self.appState.selectedAppId = appId
                        self.openBrowseWindow()
                    }
                }
                .onAppear { self.windowOpened() }
                .onDisappear { self.windowClosed() }
        }
        .defaultSize(width: 700, height: 500)

        Window("Welcome", id: "onboarding") {
            OnboardingView()
                .onAppear { self.windowOpened() }
                .onDisappear { self.windowClosed() }
        }
        .windowResizability(.contentSize)

        Settings {
            SettingsView(appState: self.appState)
        }

        .commands {
            CommandGroup(replacing: .help) {
                Button("Tips Help") {
                    if let url = URL(string: "https://github.com/shepherdjerred/monorepo") {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
            CommandGroup(after: .pasteboard) {
                Button("Copy Current Tip") {
                    self.copyCurrentTip()
                }
                .keyboardShortcut("c", modifiers: [.command, .shift])
            }
            CommandGroup(after: .sidebar) {
                Button("Toggle Sidebar") {
                    NSApp.sendAction(#selector(NSSplitViewController.toggleSidebar(_:)), to: nil, from: nil)
                }
                .keyboardShortcut("s", modifiers: [.command, .control])
            }
        }
    }

    // MARK: Private

    @State private var appState: AppState
    @State private var openWindowCount = 0

    @Environment(\.openWindow) private var openWindow

    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false

    private let notificationDelegate = NotificationDelegate()

    @ViewBuilder
    private var menuContent: some View {
        if let tip = self.appState.currentTip {
            Text("\(tip.appName) — \(tip.category)")
            if let shortcut = tip.shortcut {
                Text("\(shortcut) — \(tip.text)")
            } else {
                Text(tip.text)
            }

            Divider()

            Button("Next Tip") { self.appState.showNextTip() }
                .keyboardShortcut(.rightArrow, modifiers: .command)
            Button("Previous Tip") { self.appState.showPreviousTip() }
                .keyboardShortcut(.leftArrow, modifiers: .command)
            Button("Random Tip") { self.appState.showRandomTip() }
                .keyboardShortcut("r", modifiers: .command)

            Divider()

            Button("Got It") { self.appState.markCurrentTipLearned() }
            Button("Show Again") { self.appState.markCurrentTipShowAgain() }
            Button(
                self.appState.reviewManager.isFavorite(tip.id)
                    ? "★ Unfavorite" : "☆ Favorite"
            ) {
                self.appState.toggleCurrentTipFavorite()
            }
            .keyboardShortcut("f", modifiers: [.command, .shift])

            Divider()

            Button("Copy Tip") { self.copyCurrentTip() }
                .keyboardShortcut("c", modifiers: .command)
        } else {
            Text("No tips loaded")
            Text("Directory: \(self.appState.contentDirectoryPath)")
        }

        Divider()

        Button("Browse All Tips…") { self.openBrowseWindow() }
            .keyboardShortcut("b", modifiers: .command)

        Divider()

        Button("About Tips") {
            NSApplication.shared.orderFrontStandardAboutPanel()
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
        SettingsLink()
        Button("Quit Tips") { NSApplication.shared.terminate(nil) }
            .keyboardShortcut("q", modifiers: .command)
            .task(id: self.hasCompletedOnboarding) {
                if !self.hasCompletedOnboarding {
                    try? await Task.sleep(for: .milliseconds(500))
                    self.openWindow(id: "onboarding")
                }
            }
    }

    private static func findContentDirectory() -> URL {
        if let resourceURL = Bundle.module.resourceURL {
            let bundledContentURL = resourceURL.appendingPathComponent("content", isDirectory: true)

            if self.containsMarkdownFiles(at: bundledContentURL) {
                return bundledContentURL
            }

            if self.containsMarkdownFiles(at: resourceURL) {
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
                .appendingPathComponent("content")
        ]

        for path in possiblePaths where FileManager.default.fileExists(atPath: path.path) {
            return path
        }

        return possiblePaths[0]
    }

    private static func containsMarkdownFiles(at directory: URL) -> Bool {
        guard let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else {
            return false
        }

        while let fileURL = enumerator.nextObject() as? URL {
            if fileURL.pathExtension == "md" {
                return true
            }
        }
        return false
    }

    private func windowOpened() {
        self.openWindowCount += 1
        NSApplication.shared.setActivationPolicy(.regular)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func windowClosed() {
        self.openWindowCount = max(0, self.openWindowCount - 1)
        if self.openWindowCount == 0 {
            NSApplication.shared.setActivationPolicy(.accessory)
        }
    }

    private func openTipWindow() {
        Logger.lifecycle.info("Opening tip window")
        self.openWindow(id: "tip")
    }

    private func copyCurrentTip() {
        guard let tip = self.appState.currentTip else {
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(tip.formattedText, forType: .string)
    }

    private func openBrowseWindow() {
        Logger.lifecycle.info("Opening browse window")
        if let tip = self.appState.currentTip {
            let appId = tip.appName.lowercased().replacingOccurrences(of: " ", with: "-")
            self.appState.selectedAppId = appId
        }

        self.openWindow(id: "browse")
    }
}
