public import AppKit
import Foundation
import KeyboardShortcuts
public import Observation
public import SwiftUI
public import TaskNotesFacetUI
import TaskNotesKit

@Observable
public final class FacetMacEnvironment {
    fileprivate static weak var sharedEnvironment: FacetMacEnvironment?

    public let store: FacetStore
    @ObservationIgnored internal let bootstrap: _Concurrency.Task<Void, Never>
    @ObservationIgnored private var panel: QuickAddPanel?
    fileprivate var focusRequest = 0

    public convenience init() {
        let applicationStore = FacetStore()
        self.init(
            store: applicationStore,
            startup: {
                await applicationStore.start()
            }
        )
        Self.sharedEnvironment = self
        if !store.isIsolatedLaunch {
            KeyboardShortcuts.onKeyDown(for: .quickAdd) { [weak self] in
                MainActor.assumeIsolated { self?.toggleQuickAdd() }
            }
        }
    }

    /// Bootstrap belongs to the application even when a hidden launch creates
    /// no visible workspace. Views still await the store's shared startup task.
    internal init(store: FacetStore, startup: @escaping @MainActor () async -> Void) {
        self.store = store
        bootstrap = _Concurrency.Task { await startup() }
    }

    public func toggleQuickAdd() {
        if let panel, panel.isVisible {
            panel.orderOut(nil)
            return
        }
        if panel == nil {
            panel = QuickAddPanel(
                content: NSHostingView(rootView: FacetMacQuickCapture(environment: self))
            )
        }
        guard let panel,
            let screen = QuickAddPanel.preferredScreen(pointerAt: NSEvent.mouseLocation)
        else { return }
        if focusRequest == 0 { resizeQuickAdd(expanded: false) }
        panel.setFrameOrigin(QuickAddPanel.origin(on: screen))
        panel.orderFrontRegardless()
        panel.makeKey()
        focusRequest += 1
    }

    fileprivate func dismissQuickAdd() {
        panel?.orderOut(nil)
    }

    fileprivate func resizeQuickAdd(expanded: Bool) {
        guard let panel else { return }
        let top = panel.frame.maxY
        let maximum = panel.screen?.visibleFrame.height ?? 800
        panel.setContentSize(CGSize(width: 560, height: min(expanded ? 410 : 218, maximum - 80)))
        panel.setFrameOrigin(CGPoint(x: panel.frame.minX, y: top - panel.frame.height))
    }
}

/// Application termination delegate ensuring pending SQLite writes and outbox sync flush cleanly.
public final class TaskNotesApplicationDelegate: NSObject, NSApplicationDelegate {
    private var terminationConfirmed = false

    public override init() {
        super.init()
    }

    public func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply
    {
        if terminationConfirmed {
            terminationConfirmed = false
            return .terminateNow
        }
        guard let environment = FacetMacEnvironment.sharedEnvironment else {
            return .terminateNow
        }
        _Concurrency.Task { @MainActor in
            _ = await environment.store.flushBeforeClose()
            terminationConfirmed = true
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }
}

public struct FacetMacRootView: View {
    private let environment: FacetMacEnvironment

    public init(environment: FacetMacEnvironment) {
        self.environment = environment
    }

    public var body: some View {
        FacetRootView(store: environment.store)
            .frame(minWidth: 820, minHeight: 540)
            .background(FacetWorkspaceWindowIdentity().frame(width: 0, height: 0))
    }
}

public struct FacetMacCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @FocusedValue(\.facetWindowCommands) private var window: FacetWindowCommandActions?
    private let environment: FacetMacEnvironment

    public init(environment: FacetMacEnvironment) {
        self.environment = environment
    }

    public var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Window") { openWindow(id: "facet.workspace") }
            Button("New Task") { window?.newTask() }
                .keyboardShortcut("n")
                .disabled(window == nil)
            Button("Quick Add…") { environment.toggleQuickAdd() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
        }
        CommandGroup(after: .pasteboard) {
            Divider()
            Button("Delete") { window?.delete() }
                .keyboardShortcut(.delete, modifiers: .command)
                .disabled(window?.hasSelection != true)
        }
        CommandGroup(after: .textEditing) {
            Divider()
            Button("Find…") { window?.find() }
                .keyboardShortcut("f")
                .disabled(window == nil)
        }
        CommandGroup(after: .undoRedo) {
            Button("Undo Last Task Change") {
                environment.store.undoLast()
            }
            .keyboardShortcut("z", modifiers: [.command, .option])
            .disabled(!environment.store.canUndo)
        }
        SidebarCommands()
        ToolbarCommands()
        CommandGroup(after: .sidebar) {
            Button(window?.inspectorPresented == true ? "Close Task" : "Open Task") {
                window?.toggleInspector()
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
            .disabled(window?.hasSelection != true)
            Divider()
            Button("Inbox") { window?.navigate("inbox") }
                .keyboardShortcut("1")
                .disabled(window == nil)
            Button("Today") { window?.navigate("today") }
                .keyboardShortcut("2")
                .disabled(window == nil)
            Button("Upcoming") { window?.navigate("upcoming") }
                .keyboardShortcut("3")
                .disabled(window == nil)
            Button("Completed") { window?.navigate("completed") }
                .keyboardShortcut("4")
                .disabled(window == nil)
            Button("Board") { window?.navigate("board") }
                .keyboardShortcut("5")
                .disabled(window == nil)
            Button("Sync Now") { window?.refresh() }
                .keyboardShortcut("r")
                .disabled(window == nil)
        }
        CommandMenu("Task") {
            Button("Complete") { window?.complete() }
                .keyboardShortcut(".", modifiers: .command)
                .disabled(window?.hasSelection != true)
        }
    }
}

private struct FacetWorkspaceWindowIdentity: NSViewRepresentable {
    func makeNSView(context: Context) -> WindowIdentityView { WindowIdentityView() }
    func updateNSView(_ view: WindowIdentityView, context: Context) {}

    final class WindowIdentityView: NSView {
        private let accessibilityID = "facet.workspace." + UUID().uuidString.lowercased()

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            let attachedWindow = unsafe window
            attachedWindow?.setAccessibilityIdentifier(accessibilityID)
        }
    }
}

public struct FacetMacSettingsView: View {
    private let environment: FacetMacEnvironment

    public init(environment: FacetMacEnvironment) {
        self.environment = environment
    }

    public var body: some View {
        TabView {
            FacetSettingsAndOnboardingView(store: environment.store, embeddedInTab: true)
                .tabItem {
                    Label("General & Sync", systemImage: "icloud")
                }

            QuickAddSettingsView()
                .tabItem {
                    Label("Shortcuts", systemImage: "command")
                }
        }
        .frame(width: 540, height: 460)
        .task {
            await environment.store.start()
        }
    }
}

private struct FacetMacQuickCapture: View {
    let environment: FacetMacEnvironment

    var body: some View {
        let store = environment.store
        FacetCaptureForm(
            store: store,
            focusRequest: environment.focusRequest,
            retainedPanel: true,
            close: environment.dismissQuickAdd,
            expandedChanged: environment.resizeQuickAdd
        )
        .onExitCommand { environment.dismissQuickAdd() }
        .task { await store.start() }
        .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.panel)
    }
}
