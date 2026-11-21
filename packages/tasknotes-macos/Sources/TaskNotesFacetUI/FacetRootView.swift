import Foundation
public import SwiftUI
import TaskNotesKit

public struct FacetRootView: View {
    @State private var store: FacetStore
    @State private var presentedModal: FacetPresentedEntityModal?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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

            if !store.showsCapture {
                FacetUndoNotice(store: store)
                    #if os(iOS)
                        .padding(.bottom, 136)
                    #else
                        .padding(.bottom, 18)
                    #endif
            }
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: store.undoToastMessage)
        .task {
            await store.start()
            await afterStart?()
        }
        .onChange(of: scenePhase) {
            guard scenePhase == .active, !store.isIsolatedLaunch else { return }
            store.calendar = ViewerCalendar()
            if store.hasConfiguredToken {
                _Concurrency.Task { await store.syncNow() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged)) { _ in
            if !store.isIsolatedLaunch { store.calendar = ViewerCalendar() }
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

internal struct FacetUndoNotice: View {
    let store: FacetStore

    var body: some View {
        if let message = store.undoToastMessage {
            let receipt = store.toastReceiptID
            FacetUndoToastView(
                message: message,
                canUndo: receipt != nil && receipt == store.localStore.latestUndoEntry?.id,
                onUndo: { store.undoAction(for: receipt) },
                onDismiss: { store.dismissUndoToast() }
            )
            .transition(.opacity)
        }
    }
}
