public import SwiftUI

/// The originating scene must still be foreground/key when its receipt arrives.
public struct FacetFeedbackScene: ViewModifier {
    let store: FacetStore
    @State private var origin: FacetFeedbackOrigin
    @Environment(\.scenePhase) private var phase
    #if os(macOS)
        @Environment(\.controlActiveState) private var control
    #endif

    public init(store: FacetStore, origin: FacetFeedbackOrigin = FacetFeedbackOrigin()) {
        self.store = store
        _origin = State(initialValue: origin)
    }
    public func body(content: Content) -> some View {
        content.environment(\.facetFeedbackOrigin, origin)
            .onAppear { update() }
            .onDisappear { store.setFeedbackScene(origin, active: false) }
            .onChange(of: phase) { update() }
            #if os(macOS)
                .onChange(of: control) { update() }
            #endif
    }
    private func update() {
        #if os(macOS)
            // A nonactivating Quick Add panel intentionally accepts keyboard
            // input while the application scene remains inactive.
            store.setFeedbackScene(
                origin,
                active: control == .key && (phase == .active || origin.surface == .quickAdd))
        #else
            store.setFeedbackScene(origin, active: phase == .active)
        #endif
    }
}
