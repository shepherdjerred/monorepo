import AppKit
import Foundation
import KeyboardShortcuts
public import Observation
public import SwiftUI
public import TaskNotesFacetUI
import TaskNotesKit

@Observable
public final class FacetMacEnvironment {
    public let store = FacetStore()
    @ObservationIgnored private var panel: QuickAddPanel?
    fileprivate var focusRequest = 0

    public init() {
        KeyboardShortcuts.onKeyDown(for: .quickAdd) { [weak self] in
            MainActor.assumeIsolated { self?.toggleQuickAdd() }
        }
        _Concurrency.Task { await store.start() }
    }

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
        #if DEBUG
            FacetRootView(
                store: environment.store,
                afterStart: {
                    if CommandLine.arguments.contains("--facet-native-acceptance") {
                        do {
                            let directory = try await _Concurrency.Task.detached {
                                let root = try FileManager.default.url(
                                    for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true)
                                let directory = root.appendingPathComponent(
                                    "Facet Native Acceptance")
                                try FileManager.default.createDirectory(
                                    at: directory, withIntermediateDirectories: true)
                                return directory
                            }.value
                            await environment.store.prepareAcceptanceVault(directory)
                        } catch {
                            assertionFailure("Native acceptance vault could not be prepared.")
                        }
                    }
                }
            ).frame(minWidth: 760, minHeight: 520)
        #else
            FacetRootView(store: environment.store).frame(minWidth: 760, minHeight: 520)
        #endif
    }
}

public struct FacetMacCommands: Commands {
    @FocusedValue(\.facetWindowCommands) private var window: FacetWindowCommandActions?
    private let environment: FacetMacEnvironment
    public init(environment: FacetMacEnvironment) { self.environment = environment }
    public var body: some Commands {
        CommandGroup(replacing: .newItem) {
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

public struct FacetMacSettingsView: View {
    private let environment: FacetMacEnvironment
    public init(environment: FacetMacEnvironment) { self.environment = environment }
    public var body: some View {
        FacetMacSettingsContent(store: environment.store)
    }
}

internal struct FacetMacSettingsContent: View {
    let store: FacetStore

    var body: some View {
        VStack {
            QuickAddSettingsView()
            GroupBox("Feedback") { FacetFeedbackSettings().padding(8) }
            Button("Connect Obsidian Sync…") { store.showsAccount = true }
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
        .modifier(
            FacetFeedbackScene(store: store, origin: FacetFeedbackOrigin(surface: .quickAdd))
        )
        .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.panel)
    }
}
