import Foundation
import SwiftUI
import TaskNotesKit

#if os(macOS)
    import AppKit
#else
    import UIKit
#endif

internal struct FacetColorSwatch: Identifiable {
    let name: String
    let label: String
    let color: Color

    var id: String { name }
}

internal enum FacetNativeStyle {
    static let tokens = FacetPresentationTokens.shared
    static let mobileCaptureDiameter: CGFloat = 56
    static let mobileCapturePadding: CGFloat = 20
    static let mobileCaptureClearance: CGFloat = 20

    static var mobileListBottomMargin: CGFloat {
        mobileCaptureDiameter + mobileCapturePadding + mobileCaptureClearance
    }

    static var brand: Color {
        #if os(iOS)
            Color(
                uiColor: UIColor { traits in
                    traits.userInterfaceStyle == .dark
                        ? UIColor(red: 1, green: 0.43, blue: 0.37, alpha: 1)
                        : UIColor(red: 0.77, green: 0.19, blue: 0.15, alpha: 1)
                })
        #else
            Color(
                nsColor: NSColor(name: nil) { appearance in
                    appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                        ? NSColor(srgbRed: 1, green: 0.43, blue: 0.37, alpha: 1)
                        : NSColor(srgbRed: 0.77, green: 0.19, blue: 0.15, alpha: 1)
                })
        #endif
    }

    static let actionFill = Color(.sRGB, red: 0.77, green: 0.19, blue: 0.15, opacity: 1)

    static let colorSwatches: [FacetColorSwatch] = [
        FacetColorSwatch(
            name: "charcoal",
            label: "Charcoal",
            color: Color(.sRGB, red: 0.50, green: 0.50, blue: 0.52, opacity: 1)
        ),
        FacetColorSwatch(
            name: "berry_red",
            label: "Berry Red",
            color: Color(.sRGB, red: 0.72, green: 0.14, blue: 0.37, opacity: 1)
        ),
        FacetColorSwatch(
            name: "red",
            label: "Red",
            color: Color(.sRGB, red: 0.86, green: 0.25, blue: 0.21, opacity: 1)
        ),
        FacetColorSwatch(
            name: "orange",
            label: "Orange",
            color: Color(.sRGB, red: 0.95, green: 0.52, blue: 0.15, opacity: 1)
        ),
        FacetColorSwatch(
            name: "yellow",
            label: "Yellow",
            color: Color(.sRGB, red: 0.92, green: 0.73, blue: 0.08, opacity: 1)
        ),
        FacetColorSwatch(
            name: "green",
            label: "Green",
            color: Color(.sRGB, red: 0.16, green: 0.65, blue: 0.33, opacity: 1)
        ),
        FacetColorSwatch(
            name: "teal",
            label: "Teal",
            color: Color(.sRGB, red: 0.08, green: 0.62, blue: 0.64, opacity: 1)
        ),
        FacetColorSwatch(
            name: "blue",
            label: "Blue",
            color: Color(.sRGB, red: 0.16, green: 0.45, blue: 0.88, opacity: 1)
        ),
        FacetColorSwatch(
            name: "grape",
            label: "Grape",
            color: Color(.sRGB, red: 0.53, green: 0.30, blue: 0.85, opacity: 1)
        ),
        FacetColorSwatch(
            name: "magenta",
            label: "Magenta",
            color: Color(.sRGB, red: 0.88, green: 0.32, blue: 0.60, opacity: 1)
        ),
        FacetColorSwatch(
            name: "salmon",
            label: "Salmon",
            color: Color(.sRGB, red: 0.96, green: 0.51, blue: 0.48, opacity: 1)
        ),
        FacetColorSwatch(
            name: "grey",
            label: "Grey",
            color: Color(.sRGB, red: 0.58, green: 0.60, blue: 0.63, opacity: 1)
        ),
    ]

    static func swatchColor(_ rawName: String?) -> Color {
        guard let rawName, !rawName.isEmpty else {
            return .secondary
        }
        let lower = rawName.lowercased()
        if let match = colorSwatches.first(where: { $0.name == lower }) {
            return match.color
        }
        if let parsed = FacetConfiguredColor(rawName) {
            return Color(
                .sRGB,
                red: parsed.red,
                green: parsed.green,
                blue: parsed.blue,
                opacity: parsed.alpha
            )
        }
        return .secondary
    }

    static func priorityColor(_ priority: Priority) -> Color {
        switch priority {
        case .p1: .red
        case .p2: .orange
        case .p3: .blue
        case .p4: .secondary
        }
    }

    static func priorityTitle(_ priority: Priority) -> String {
        switch priority {
        case .p1: "P1"
        case .p2: "P2"
        case .p3: "P3"
        case .p4: "P4"
        }
    }

    static func priorityFullTitle(_ priority: Priority) -> String {
        switch priority {
        case .p1: "Priority 1"
        case .p2: "Priority 2"
        case .p3: "Priority 3"
        case .p4: "Priority 4"
        }
    }
}
