import AppKit
import SwiftUI

/// Renders SwiftUI views offscreen into deterministic 2x PNG snapshots without stealing focus.
@MainActor
enum OffscreenSnapshot {
    static let scale: CGFloat = 2

    static let directory: URL = URL(filePath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appending(path: ".build/snapshots")

    static func write(
        _ view: some View,
        named name: String,
        size: CGSize,
        appearance: SnapshotAppearance,
        highContrast: Bool = false
    ) throws -> RenderedSnapshot {
        let rep = try render(view, size: size, appearance: appearance, highContrast: highContrast)
        return try save(rep, named: name, appearance: appearance)
    }

    private static func save(
        _ rep: NSBitmapImageRep,
        named name: String,
        appearance: SnapshotAppearance
    ) throws -> RenderedSnapshot {
        guard let png = rep.representation(using: .png, properties: [:]) else {
            throw Failure.pngEncodingRefused(name)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appending(path: "\(name).\(appearance.suffix).png")
        try png.write(to: url, options: [.atomic])
        return RenderedSnapshot(
            url: url,
            byteCount: png.count,
            pixelSize: CGSize(width: rep.pixelsWide, height: rep.pixelsHigh),
            distinctColors: distinctColors(in: rep)
        )
    }

    private static func render(
        _ view: some View,
        size: CGSize,
        appearance: SnapshotAppearance,
        highContrast: Bool
    ) throws -> NSBitmapImageRep {
        let surface = makeSurface(
            view,
            size: size,
            appearance: appearance,
            highContrast: highContrast
        )
        defer { surface.close() }
        settle(surface.hosting)
        let rep = try bitmap(size: size)
        surface.hosting.cacheDisplay(in: surface.hosting.bounds, to: rep)
        return rep
    }

    private struct Surface {
        let hosting: NSView
        let window: NSWindow
        let previousAppearance: NSAppearance?

        func close() {
            window.contentView = nil
            window.close()
            NSApplication.shared.appearance = previousAppearance
        }
    }

    private static func makeSurface(
        _ view: some View,
        size: CGSize,
        appearance: SnapshotAppearance,
        highContrast: Bool
    ) -> Surface {
        prepareApplication()
        let appearanceName =
            highContrast
            ? (appearance == .dark
                ? NSAppearance.Name.accessibilityHighContrastDarkAqua
                : NSAppearance.Name.accessibilityHighContrastAqua)
            : appearance.appearanceName
        let nsAppearance = NSAppearance(named: appearanceName)
        let previousAppearance = NSApplication.shared.appearance
        NSApplication.shared.appearance = nsAppearance
        let hosting = NSHostingView(
            rootView:
                view
                .environment(\.colorScheme, appearance.colorScheme)
                .frame(width: size.width, height: size.height)
                .background(Color(nsColor: .windowBackgroundColor))
        )
        hosting.frame = CGRect(origin: .zero, size: size)
        hosting.appearance = nsAppearance

        let window = NSWindow(
            contentRect: CGRect(origin: .zero, size: size),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.isExcludedFromWindowsMenu = true
        window.appearance = nsAppearance
        window.contentView = hosting
        return Surface(hosting: hosting, window: window, previousAppearance: previousAppearance)
    }

    private static func settle(_ hosting: NSView) {
        for _ in 0..<8 {
            hosting.layoutSubtreeIfNeeded()
            hosting.displayIfNeeded()
            RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.02))
        }
        hosting.layoutSubtreeIfNeeded()
        hosting.displayIfNeeded()
    }

    private static func bitmap(size: CGSize) throws -> NSBitmapImageRep {
        let pixelsWide = Int(size.width * scale)
        let pixelsHigh = Int(size.height * scale)
        let rep = unsafe NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: pixelsWide,
            pixelsHigh: pixelsHigh,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        )
        guard let rep else {
            throw Failure.bitmapRefused(pixelsWide: pixelsWide, pixelsHigh: pixelsHigh)
        }
        rep.size = size
        return rep
    }

    private static func distinctColors(in rep: NSBitmapImageRep) -> Int {
        let strideX = max(1, rep.pixelsWide / 160)
        let strideY = max(1, rep.pixelsHigh / 160)
        var seen: Set<Int> = []
        for y in stride(from: 0, to: rep.pixelsHigh, by: strideY) {
            for x in stride(from: 0, to: rep.pixelsWide, by: strideX) {
                guard let color = rep.colorAt(x: x, y: y) else { continue }
                let red = Int(color.redComponent * 255)
                let green = Int(color.greenComponent * 255)
                let blue = Int(color.blueComponent * 255)
                seen.insert(red << 16 | green << 8 | blue)
            }
        }
        return seen.count
    }

    private static func prepareApplication() {
        let app = NSApplication.shared
        guard app.activationPolicy() != .prohibited else { return }
        app.setActivationPolicy(.prohibited)
    }

    enum Failure: Error, CustomStringConvertible {
        case bitmapRefused(pixelsWide: Int, pixelsHigh: Int)
        case pngEncodingRefused(String)

        var description: String {
            switch self {
            case .bitmapRefused(let pixelsWide, let pixelsHigh):
                "AppKit refused a \(pixelsWide)×\(pixelsHigh)px bitmap"
            case .pngEncodingRefused(let name):
                "the rendered bitmap for \(name) could not be encoded as PNG"
            }
        }
    }
}

enum SnapshotAppearance: String, CaseIterable, Sendable {
    case light
    case dark

    var suffix: String { rawValue }

    var appearanceName: NSAppearance.Name {
        switch self {
        case .light: .aqua
        case .dark: .darkAqua
        }
    }

    var colorScheme: ColorScheme {
        switch self {
        case .light: .light
        case .dark: .dark
        }
    }
}

struct RenderedSnapshot: Sendable {
    let url: URL
    let byteCount: Int
    let pixelSize: CGSize
    let distinctColors: Int
}
