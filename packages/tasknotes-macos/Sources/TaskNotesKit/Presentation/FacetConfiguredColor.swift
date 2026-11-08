import Foundation

public struct FacetConfiguredColor: Sendable, Equatable {
    public let red: Double
    public let green: Double
    public let blue: Double
    public let alpha: Double

    public init?(_ raw: String) {
        let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let names = FacetColorPolicy.shared.namedColors
        let value = names[normalized] ?? normalized
        guard value.hasPrefix("#") else { return nil }
        let hex = String(value.dropFirst())
        guard [3, 4, 6, 8].contains(hex.count), let number = UInt64(hex, radix: 16) else {
            return nil
        }
        if hex.count <= 4 {
            let rgb = hex.count == 4 ? number >> 4 : number
            red = Double((rgb >> 8) & 15) / 15
            green = Double((rgb >> 4) & 15) / 15
            blue = Double(rgb & 15) / 15
            alpha = hex.count == 4 ? Double(number & 15) / 15 : 1
        } else {
            let rgb = hex.count == 8 ? number >> 8 : number
            red = Double((rgb >> 16) & 255) / 255
            green = Double((rgb >> 8) & 255) / 255
            blue = Double(rgb & 255) / 255
            alpha = hex.count == 8 ? Double(number & 255) / 255 : 1
        }
    }
}
