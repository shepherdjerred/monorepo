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
        panel.setFrameOrigin(QuickAddPanel.origin(on: screen))
        panel.orderFrontRegardless()
        panel.makeKey()
    }

    fileprivate func dismissQuickAdd() { panel?.orderOut(nil) }
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
            Button("Connect Obsidian Sync…") { store.showsAccount = true }
            Button("Sign out of Obsidian") {
                _Concurrency.Task { await store.signOut() }
            }
        }.padding().frame(width: 480, height: 320)
    }
}

private struct FacetMacQuickCapture: View {
    let environment: FacetMacEnvironment
    @State private var draft = FacetCaptureDraft()
    @State private var owningProfileID: String?
    @FocusState private var focused: Bool
    var body: some View {
        let store = environment.store
        VStack(alignment: .leading, spacing: 8) {
            TextField("Add a task", text: $draft.input)
                .font(.title3).textFieldStyle(.plain).focused($focused)
                .disabled(store.selectedProfileID == nil)
                .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.field)
                .onSubmit {
                    guard let profileID = owningProfileID,
                        draft.begin(store: store, profileID: profileID)
                    else { return }
                    _Concurrency.Task {
                        let applied = await draft.submit(store: store)
                        if applied && draft.input.isEmpty { environment.dismissQuickAdd() }
                    }
                }
            if draft.isSubmitting { ProgressView().controlSize(.small) }
            if let error = draft.error {
                Text(error).font(.caption).foregroundStyle(.red)
                Button("Discard draft") { _Concurrency.Task { await draft.discard(store: store) } }
                    .disabled(draft.isSubmitting)
            } else {
                Text(
                    store.selectedProfileID == nil
                        ? "Open a vault in Facet before adding tasks."
                        : "Return adds the task · Escape closes"
                ).font(.caption).foregroundStyle(.secondary)
            }
        }.padding(20).frame(width: 560).frame(minHeight: 118)
            .onAppear {
                if draft.input.isEmpty, !draft.hasRetainedSubmission {
                    owningProfileID = store.selectedProfileID
                }
                if let owningProfileID {
                    draft.registerLifecycle(store: store, profileID: owningProfileID)
                }
                focused = true
            }
            .onChange(of: draft.input) { previous, value in
                if previous.isEmpty, !value.isEmpty, !draft.hasRetainedSubmission {
                    owningProfileID = store.selectedProfileID
                    if let owningProfileID {
                        draft.registerLifecycle(store: store, profileID: owningProfileID)
                    }
                }
            }
            .onExitCommand { environment.dismissQuickAdd() }
            .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.panel)
    }
}
