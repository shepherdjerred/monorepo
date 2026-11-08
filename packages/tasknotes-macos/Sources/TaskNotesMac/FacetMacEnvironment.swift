import AppKit
import Foundation
import KeyboardShortcuts
public import Observation
public import SwiftUI
public import TaskNotesFacetUI
import TaskNotesKit

@Observable
public final class FacetMacEnvironment {
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
                #if DEBUG
                    await Self.prepareAcceptanceVault(store: applicationStore)
                #endif
            })
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

    #if DEBUG
        internal static func prepareAcceptanceVault(
            store: FacetStore, arguments: [String] = CommandLine.arguments
        ) async {
            guard arguments.contains("--facet-native-acceptance") else { return }
            do {
                guard let root = store.acceptanceDirectory else {
                    throw FacetAcceptanceError.invalidDescriptor
                }
                let directory = try await _Concurrency.Task.detached {
                    let directory = root.appendingPathComponent("Native acceptance")
                    try FileManager.default.createDirectory(
                        at: directory, withIntermediateDirectories: true)
                    return directory
                }.value
                try await store.prepareAcceptanceVault(directory)
            } catch {
                store.reportNativeFailure(error)
                assertionFailure("Native acceptance vault could not be prepared.")
            }
        }
    #endif

    public func toggleQuickAdd() {
        if let panel, panel.isVisible {
            panel.orderOut(nil)
            return
        }
        if panel == nil {
            panel = QuickAddPanel(
                content: NSHostingView(rootView: FacetMacQuickCapture(environment: self)))
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

    fileprivate func dismissQuickAdd() { panel?.orderOut(nil) }
    fileprivate func resizeQuickAdd(expanded: Bool) {
        guard let panel else { return }
        let top = panel.frame.maxY
        let maximum = panel.screen?.visibleFrame.height ?? 800
        panel.setContentSize(CGSize(width: 560, height: min(expanded ? 660 : 420, maximum - 80)))
        panel.setFrameOrigin(CGPoint(x: panel.frame.minX, y: top - panel.frame.height))
    }
}

public struct FacetMacRootView: View {
    private let environment: FacetMacEnvironment
    public init(environment: FacetMacEnvironment) { self.environment = environment }
    public var body: some View {
        FacetRootView(store: environment.store).frame(minWidth: 760, minHeight: 520)
            .background(FacetWorkspaceWindowIdentity().frame(width: 0, height: 0))
    }
}

public struct FacetMacCommands: Commands {
    @Environment(\.openWindow) private var openWindow
    @FocusedValue(\.facetWindowCommands) private var window: FacetWindowCommandActions?
    private let environment: FacetMacEnvironment
    public init(environment: FacetMacEnvironment) { self.environment = environment }
    public var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Window") { openWindow(id: "facet.workspace") }
            Button("New Task") { window?.newTask() }.keyboardShortcut("n")
                .disabled(window == nil)
            Button("Quick Add…") { environment.toggleQuickAdd() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
        }
        CommandGroup(after: .pasteboard) {
            Divider()
            Button("Delete") { window?.delete() }.keyboardShortcut(.delete, modifiers: .command)
                .disabled(window?.hasSelection != true)
        }
        CommandGroup(after: .textEditing) {
            Divider()
            Button("Find…") { window?.find() }.keyboardShortcut("f").disabled(window == nil)
        }
        CommandGroup(after: .undoRedo) {
            Button("Undo last task change") {
                guard let profileID = environment.store.selectedProfileID else { return }
                _Concurrency.Task { await environment.store.undoLast(profileID: profileID) }
            }.keyboardShortcut("z", modifiers: [.command, .option]).disabled(window == nil)
        }
        SidebarCommands()
        ToolbarCommands()
        CommandGroup(after: .sidebar) {
            Button(window?.inspectorPresented == true ? "Hide Inspector" : "Show Inspector") {
                window?.toggleInspector()
            }
            .keyboardShortcut("i", modifiers: [.command, .option]).disabled(window == nil)
            Divider()
            Button("Inbox") { window?.navigate("inbox") }.keyboardShortcut("1").disabled(
                window == nil)
            Button("Today") { window?.navigate("today") }.keyboardShortcut("2").disabled(
                window == nil)
            Button("Upcoming") { window?.navigate("upcoming") }.keyboardShortcut("3").disabled(
                window == nil)
            Button("All Tasks") { window?.navigate("all") }.keyboardShortcut("4").disabled(
                window == nil)
            Button("Refresh") { window?.refresh() }.keyboardShortcut("r").disabled(window == nil)
        }
        CommandMenu("Task") {
            Button("Complete") { window?.complete() }.keyboardShortcut(".", modifiers: .command)
                .disabled(window?.hasSelection != true)
        }
    }
}

/// Name the actual AppKit window; a SwiftUI content identifier cannot address
/// two workspace windows independently through native accessibility.
private struct FacetWorkspaceWindowIdentity: NSViewRepresentable {
    func makeNSView(context: Context) -> WindowIdentityView { WindowIdentityView() }
    func updateNSView(_ view: WindowIdentityView, context: Context) {}

    final class WindowIdentityView: NSView {
        private let accessibilityID = "facet.workspace." + UUID().uuidString.lowercased()
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            // AppKit's window property is unowned(unsafe); read it only from
            // its MainActor attachment callback and retain it for this call.
            let attachedWindow = unsafe window
            attachedWindow?.setAccessibilityIdentifier(accessibilityID)
        }
    }
}

public struct FacetMacSettingsView: View {
    private let environment: FacetMacEnvironment
    public init(environment: FacetMacEnvironment) { self.environment = environment }
    public var body: some View {
        FacetMacSettingsContent(store: environment.store)
            .task { await environment.store.start() }
    }
}

internal struct FacetMacSettingsContent: View {
    let store: FacetStore

    var body: some View {
        VStack {
            QuickAddSettingsView()
            GroupBox("Feedback") { FacetFeedbackSettings(store: store).padding(8) }
            FacetAccountConnectionButton(store: store)
            Button("Sign out of Obsidian") {
                _Concurrency.Task { await store.signOut() }
            }
        }.padding().frame(width: 480).frame(minHeight: 420)
    }
}

private struct FacetMacQuickCapture: View {
    let environment: FacetMacEnvironment
    var body: some View {
        let store = environment.store
        FacetCaptureForm(
            store: store, focusRequest: environment.focusRequest,
            retainedPanel: true, close: environment.dismissQuickAdd,
            expandedChanged: environment.resizeQuickAdd
        )
        .onExitCommand { environment.dismissQuickAdd() }
        .task { await store.start() }
        .modifier(
            FacetFeedbackScene(store: store, origin: FacetFeedbackOrigin(surface: .quickAdd))
        )
        .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.panel)
    }
}
