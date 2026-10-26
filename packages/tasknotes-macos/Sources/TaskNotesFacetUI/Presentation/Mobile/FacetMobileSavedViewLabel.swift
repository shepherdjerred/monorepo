#if os(iOS)
    import SwiftUI
    import TaskNotesKit

    internal struct FacetMobileSavedViewLabel: View {
        let view: FacetSavedView
        private static let symbols = [
            "tray", "briefcase", "book.closed", "scope", "star", "calendar", "flag", "bookmark",
        ]

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    if let symbol = view.view["symbol"]?.text {
                        if Self.symbols.contains(symbol) {
                            Image(systemName: symbol).foregroundStyle(tint)
                        } else {
                            Label(
                                "Unsupported icon: \(symbol)",
                                systemImage: "exclamationmark.triangle"
                            )
                            .font(.caption).foregroundStyle(.secondary)
                        }
                    } else {
                        Image(systemName: "line.3.horizontal.decrease.circle").foregroundStyle(tint)
                    }
                    Text(view.view["name"]?.text ?? view.id)
                    Spacer(minLength: 4)
                    if view.view["favorite"] == .bool(true) {
                        Image(systemName: "star.fill").font(.caption).foregroundStyle(tint)
                            .accessibilityLabel("Favorite")
                    }
                }
                if let raw = view.view["tint"]?.text, FacetConfiguredColor(raw) == nil {
                    Text("Unsupported color: \(raw)").font(.caption).foregroundStyle(.secondary)
                }
            }
        }

        private var tint: Color {
            guard let raw = view.view["tint"]?.text, let color = FacetConfiguredColor(raw) else {
                return FacetNativeStyle.brand
            }
            return Color(
                .sRGB, red: color.red, green: color.green, blue: color.blue, opacity: color.alpha)
        }
    }
#endif
