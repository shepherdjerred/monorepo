import SwiftUI

internal enum FacetCaptureTarget: Hashable {
    case day(String)
    case section(String)
}

#if os(iOS)
    @MainActor
    @Observable
    internal final class FacetCaptureDropRegions {
        @ObservationIgnored var regions: [UUID: (FacetCaptureTarget, CGRect)] = [:]
        var highlighted: FacetCaptureTarget?

        func target(at point: CGPoint) -> FacetCaptureTarget? {
            regions.values.first(where: { $0.1.contains(point) })?.0
        }
    }

    extension EnvironmentValues {
        @Entry var facetCaptureRegions: FacetCaptureDropRegions?
    }

    private struct FacetCaptureDropRegion: ViewModifier {
        let target: FacetCaptureTarget?
        @Environment(\.facetCaptureRegions) private var registry
        @State private var id = UUID()

        func body(content: Content) -> some View {
            content
                .overlay {
                    if let target, registry?.highlighted == target {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(FacetNativeStyle.brand, lineWidth: 2)
                            .allowsHitTesting(false)
                    }
                }
                .onGeometryChange(for: CGRect.self) {
                    $0.frame(in: .global)
                } action: { bounds in
                    if let target { registry?.regions[id] = (target, bounds) }
                }
                .onDisappear { registry?.regions.removeValue(forKey: id) }
        }
    }
#endif

extension View {
    @ViewBuilder
    func facetCaptureTarget(_ target: FacetCaptureTarget?) -> some View {
        #if os(iOS)
            modifier(FacetCaptureDropRegion(target: target))
        #else
            self
        #endif
    }
}
