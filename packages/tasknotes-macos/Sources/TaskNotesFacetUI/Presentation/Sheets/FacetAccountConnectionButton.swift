#if os(macOS)
    public import SwiftUI

    /// Presents the shared account session from its requesting Settings window.
    public struct FacetAccountConnectionButton: View {
        private let store: FacetStore
        @State private var sheets = FacetSheetPresentation()

        public init(store: FacetStore) { self.store = store }

        public var body: some View {
            Button("Connect Obsidian Sync…") {
                sheets.account(store: store).wrappedValue = true
            }
            .disabled(store.accountWindowOwnerID != nil)
            .help("Sync is open in another window while this control is unavailable.")
            .sheet(isPresented: sheets.account(store: store)) {
                FacetAccountForm(
                    store: store, ownsPresentation: { sheets.ownsAccount(store: store) },
                    didAppear: { sheets.accountDidAppear(store: store) },
                    didDisappear: { sheets.accountDidDisappear(store: store) })
            }
            .onAppear { sheets.rootDidAppear() }
            .onDisappear { sheets.rootDidDisappear(store: store) }
        }
    }
#endif
