import Observation
import SwiftUI

/// Presentation belongs to one root window; the application still owns capture commands.
@Observable @MainActor
internal final class FacetCapturePresentation {
    private(set) var isPresented = false

    func binding(store: FacetStore) -> Binding<Bool> {
        Binding(
            get: { self.isPresented },
            set: {
                // Preserve the store's original capture-profile admission semantics.
                store.showsCapture = $0
                self.isPresented = $0
            })
    }

    func handleURL(_ url: URL, store: FacetStore) {
        store.handleURL(url)
        if url.host == "quick-add" { binding(store: store).wrappedValue = true }
    }
}
