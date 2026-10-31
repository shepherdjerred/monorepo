import SwiftUI

/// Routes shared account and conflict sessions to their requesting window.
@MainActor
internal final class FacetSheetPresentation {
    private let id = UUID()
    private var active = true
    private var accountMounted = false
    private var conflictPending = false
    private var conflictGeneration: UInt64 = 0

    func rootDidAppear() { active = true }

    func rootDidDisappear(store: FacetStore) {
        active = false
        if !accountMounted { accountDidDisappear(store: store) }
        if conflictPending { conflictsDidDisappear(store: store) }
    }

    func ownsAccount(store: FacetStore) -> Bool {
        #if os(macOS)
            store.accountWindowOwnerID == id
        #else
            true
        #endif
    }

    func accountDidAppear(store: FacetStore) {
        if ownsAccount(store: store) { accountMounted = true }
    }

    func account(store: FacetStore) -> Binding<Bool> {
        #if os(macOS)
            Binding(
                get: { store.showsAccount && store.accountWindowOwnerID == self.id },
                set: { presented in
                    if presented {
                        guard self.active, store.accountWindowOwnerID == nil else { return }
                        store.accountWindowOwnerID = self.id
                        store.showsAccount = true
                    } else if store.accountWindowOwnerID == self.id {
                        store.showsAccount = false
                    }
                })
        #else
            Binding(get: { store.showsAccount }, set: { store.showsAccount = $0 })
        #endif
    }

    func accountDidDisappear(store: FacetStore) {
        guard store.accountWindowOwnerID == id else { return }
        accountMounted = false
        store.showsAccount = false
        store.accountWindowOwnerID = nil
    }

    func conflicts(store: FacetStore) -> Binding<Bool> {
        #if os(macOS)
            Binding(
                get: { store.showsConflicts && store.conflictWindowOwnerID == self.id },
                set: { presented in
                    if !presented, store.conflictWindowOwnerID == self.id {
                        store.showsConflicts = false
                    }
                })
        #else
            Binding(get: { store.showsConflicts }, set: { store.showsConflicts = $0 })
        #endif
    }

    func openConflicts(store: FacetStore) async {
        #if os(macOS)
            await withConflictPresentation(store: store) { owns, present in
                await store.loadConflicts(ownsPresentation: owns, present: present)
            }
        #else
            await store.loadConflicts()
        #endif
    }

    func withConflictPresentation(
        store: FacetStore, load: (@escaping () -> Bool, () -> Void) async -> Void
    ) async {
        guard active, !_Concurrency.Task.isCancelled, store.conflictWindowOwnerID == nil else {
            return
        }
        conflictGeneration += 1
        let generation = conflictGeneration
        store.conflictWindowOwnerID = id
        conflictPending = true
        let owns = {
            self.active && self.conflictGeneration == generation
                && store.conflictWindowOwnerID == self.id
        }
        await load(owns) {
            guard owns(), !_Concurrency.Task.isCancelled else { return }
            self.conflictPending = false
            store.showsConflicts = true
        }
        if owns(), !store.showsConflicts { conflictsDidDisappear(store: store) }
    }

    func conflictsDidDisappear(store: FacetStore) {
        guard store.conflictWindowOwnerID == id else { return }
        conflictGeneration += 1
        conflictPending = false
        store.showsConflicts = false
        store.conflictWindowOwnerID = nil
    }
}
