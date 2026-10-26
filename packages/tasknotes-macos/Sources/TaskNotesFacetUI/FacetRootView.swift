public import SwiftUI
import TaskNotesKit
import UniformTypeIdentifiers

private struct ReminderProjectionIdentity: Hashable {
    let profiles: [String]
    let version: UInt64?
}

public struct FacetRootView: View {
    @State private var store: FacetStore
    @State private var importsFolder = false
    @State private var importSource: URL?
    @State private var board = false
    @State private var capturePresentation = FacetCapturePresentation()
    @State private var captureSeed: FacetCaptureSeed?
    @State private var sheets = FacetSheetPresentation()
    @Environment(\.scenePhase) private var scenePhase
    private let afterStart: (@MainActor () async -> Void)?

    public init(store: FacetStore = FacetStore(), afterStart: (@MainActor () async -> Void)? = nil)
    {
        self.store = store
        self.afterStart = afterStart
    }

    public var body: some View {
        FacetWorkspaceView(
            store: store, importsFolder: $importsFolder, board: $board,
            capturePresented: capturePresented, sheets: sheets
        )
        .environment(
            \.facetCaptureRequest,
            FacetCaptureRequest { profileID, context in
                guard store.selectedProfileID == profileID, !store.showsCapture else { return }
                captureSeed = FacetCaptureSeed(profileID: profileID, context: context)
                capturePresented.wrappedValue = true
            }
        )
        .onAppear { sheets.rootDidAppear() }
        .onDisappear { sheets.rootDidDisappear(store: store) }
        .task {
            await store.start()
            await store.installNotificationRouting()
            await afterStart?()
        }
        .task(
            id: ReminderProjectionIdentity(
                profiles: store.profiles.map(\.id), version: store.snapshot?.version)
        ) {
            await store.refreshReminders()
        }
        .onChange(of: store.search) { _Concurrency.Task { await store.reloadQuery() } }
        .onChange(of: store.status) { _Concurrency.Task { await store.reloadQuery() } }
        .onChange(of: store.priority) { _Concurrency.Task { await store.reloadQuery() } }
        .onChange(of: store.showCompleted) { _Concurrency.Task { await store.reloadQuery() } }
        .onChange(of: store.scope) { _Concurrency.Task { await store.reloadQuery() } }
        .onChange(of: store.includeArchived) { _Concurrency.Task { await store.reloadQuery() } }
        .onChange(of: scenePhase) {
            _Concurrency.Task {
                if scenePhase == .background {
                    await store.pauseSync()
                } else if scenePhase == .active {
                    await store.resumeSync()
                }
            }
        }
        .onOpenURL {
            #if os(macOS)
                capturePresentation.handleURL($0, store: store)
            #else
                store.handleURL($0)
            #endif
        }
        .sheet(item: $store.reminderEditor) { selection in
            FacetTaskEditor(
                store: store, task: selection.task, profileID: selection.profileID,
                statuses: selection.statuses, priorities: selection.priorities)
        }
        .fileImporter(isPresented: $importsFolder, allowedContentTypes: [.folder]) { result in
            switch result {
            case .success(let url):
                #if os(iOS)
                    importSource = url
                #else
                    _Concurrency.Task { await store.openLocal(url) }
                #endif
            case .failure(let error): store.reportNativeFailure(error)
            }
        }
        .confirmationDialog("Import an independent vault copy?", isPresented: importPresented) {
            Button("Import copy") {
                guard let source = importSource else { return }
                importSource = nil
                _Concurrency.Task { await store.importCopy(source) }
            }
            Button("Cancel", role: .cancel) { importSource = nil }
        } message: {
            Text(
                "Facet copies the vault and attachments into this app. "
                    + "The original stays unchanged. Later edits do not sync with the source folder."
            )
        }
        .sheet(
            isPresented: capturePresented, onDismiss: { captureSeed = nil },
            content: {
                #if os(macOS)
                    FacetCaptureForm(store: store, close: { capturePresented.wrappedValue = false })
                        .padding().frame(minWidth: 300, minHeight: 180)
                #else
                    FacetCaptureForm(
                        store: store, profileID: captureSeed?.profileID,
                        context: captureSeed?.context ?? [:]
                    ).padding().frame(minHeight: 180)
                        .presentationDetents([.fraction(0.75), .large])
                        .presentationDragIndicator(.visible)
                #endif
            }
        )
        .sheet(isPresented: sheets.conflicts(store: store)) {
            FacetConflictInbox(store: store)
                .onDisappear { sheets.conflictsDidDisappear(store: store) }
        }
        .sheet(isPresented: sheets.account(store: store)) {
            FacetAccountForm(
                store: store, ownsPresentation: { sheets.ownsAccount(store: store) },
                didAppear: { sheets.accountDidAppear(store: store) },
                didDisappear: { sheets.accountDidDisappear(store: store) })
        }
        .alert(
            store.savedNotice == nil ? "Could not complete this action" : "Saved",
            isPresented: errorPresented
        ) {
            Button("OK") {
                if store.savedNotice != nil {
                    store.clearSavedNotice()
                } else {
                    store.clearError()
                    importFailure = nil
                }
            }
        } message: {
            Text(store.savedNotice ?? store.error ?? importFailure ?? "")
        }
        .modifier(FacetFeedbackScene(store: store))
        .modifier(FacetAppearanceScope())
    }

    @State private var importFailure: String?
    private var capturePresented: Binding<Bool> {
        #if os(macOS)
            capturePresentation.binding(store: store)
        #else
            $store.showsCapture
        #endif
    }
    private var importPresented: Binding<Bool> {
        Binding(get: { importSource != nil }, set: { if !$0 { importSource = nil } })
    }
    private var errorPresented: Binding<Bool> {
        Binding(
            get: { store.savedNotice != nil || store.error != nil || importFailure != nil },
            set: {
                if !$0 {
                    if store.savedNotice != nil {
                        store.clearSavedNotice()
                    } else {
                        store.clearError()
                        importFailure = nil
                    }
                }
            })
    }
}
