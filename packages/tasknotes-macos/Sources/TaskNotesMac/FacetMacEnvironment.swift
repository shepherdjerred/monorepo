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
    private let environment: FacetMacEnvironment
    public init(environment: FacetMacEnvironment) { self.environment = environment }
    public var body: some Commands {
        CommandGroup(after: .newItem) {
            Button("Quick Add…") { environment.toggleQuickAdd() }
                .keyboardShortcut("n", modifiers: [.command, .shift])
            Button("Refresh vault") { _Concurrency.Task { await environment.store.refresh() } }
                .keyboardShortcut("r", modifiers: .command)
            Button("Undo last task change") {
                guard let profileID = environment.store.selectedProfileID else { return }
                _Concurrency.Task { await environment.store.undoLast(profileID: profileID) }
            }.keyboardShortcut("z", modifiers: .command)
        }
    }
}

public struct FacetMacSettingsView: View {
    private let environment: FacetMacEnvironment
    public init(environment: FacetMacEnvironment) { self.environment = environment }
    public var body: some View {
        VStack {
            QuickAddSettingsView()
            Button("Connect Obsidian Sync…") { environment.store.showsAccount = true }
            Button("Sign out of Obsidian") {
                _Concurrency.Task { await environment.store.signOut() }
            }
        }.padding().frame(width: 480, height: 320)
    }
}

private struct FacetMacQuickCapture: View {
    let environment: FacetMacEnvironment
    @FocusState private var focused: Bool
    var body: some View {
        @Bindable var store = environment.store
        VStack(alignment: .leading, spacing: 8) {
            TextField("Add a task", text: $store.captureTitle)
                .font(.title3).textFieldStyle(.plain).focused($focused)
                .disabled(store.selectedProfileID == nil || store.isSaving)
                .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.field)
                .onSubmit {
                    _Concurrency.Task {
                        await store.createTask()
                        if store.captureTitle.isEmpty { environment.dismissQuickAdd() }
                    }
                }
            if let error = store.error {
                Text(error).font(.caption).foregroundStyle(.red)
            } else {
                Text(
                    store.selectedProfileID == nil
                        ? "Open a vault in Facet before adding tasks."
                        : "Return adds the task · Escape closes"
                ).font(.caption).foregroundStyle(.secondary)
            }
        }.padding(20).frame(width: 560, height: 118)
            .onAppear { focused = true }
            .onExitCommand { environment.dismissQuickAdd() }
            .accessibilityIdentifier(AccessibilityIdentifier.QuickAdd.panel)
    }
}
