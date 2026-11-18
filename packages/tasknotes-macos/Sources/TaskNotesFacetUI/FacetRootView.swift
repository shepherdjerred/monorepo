import Foundation
public import SwiftUI
import TaskNotesKit

public struct FacetRootView: View {
    @State private var store: FacetStore
    @State private var presentedModal: FacetPresentedEntityModal?
    @Environment(\.scenePhase) private var scenePhase
    private let afterStart: (@MainActor () async -> Void)?

    public init(
        store: FacetStore = FacetStore(),
        afterStart: (@MainActor () async -> Void)? = nil
    ) {
        self.store = store
        self.afterStart = afterStart
    }

    public var body: some View {
        ZStack(alignment: .bottom) {
            #if os(macOS)
                FacetNativeWorkspace(
                    store: store,
                    onPresentModal: { presentedModal = $0 }
                )
            #else
                FacetMobileWorkspace(
                    store: store,
                    onPresentModal: { presentedModal = $0 }
                )
            #endif

            if let toastMessage = store.undoToastMessage {
                FacetUndoToastView(
                    message: toastMessage,
                    canUndo: store.canUndo,
                    onUndo: { store.undoLast() },
                    onDismiss: { store.dismissUndoToast() }
                )
                .padding(.bottom, 18)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.2), value: store.undoToastMessage)
        .task {
            await store.start()
            await store.installNotificationRouting()
            await afterStart?()
        }
        .task(id: store.dataRevision) {
            await store.refreshReminders()
        }
        .onChange(of: scenePhase) {
            if scenePhase == .active, store.hasConfiguredToken, !store.isIsolatedLaunch {
                _Concurrency.Task { await store.syncNow() }
            }
        }
        .onOpenURL { url in
            store.handleURL(url)
        }
        .sheet(isPresented: $store.showsCapture) {
            FacetCaptureForm(
                store: store,
                close: { store.showsCapture = false }
            )
            #if os(macOS)
                .frame(minWidth: 500, minHeight: 170)
            #else
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            #endif
        }
        .sheet(isPresented: $store.showsSettings) {
            NavigationStack {
                FacetSettingsAndOnboardingView(store: store)
            }
            #if os(macOS)
                .frame(minWidth: 500, minHeight: 420)
            #endif
        }
        .sheet(item: $presentedModal) { modal in
            FacetEntityModalSheet(modal: modal, store: store)
        }
        .modifier(FacetAppearanceScope())
    }
}
