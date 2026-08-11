import AppKit
import SwiftUI

/// A SwiftUI view rendered to PNG bytes, without ever reaching a display.
///
/// ## Why "offscreen" is a hard requirement and not a preference
///
/// This runs inside `swift test` on a developer's Mac while they are using it.
/// Anything that orders a window in, activates the app, or drives the GUI
/// through AppleScript steals focus from whatever the human is typing into.
/// Three things together make that impossible here:
///
///   1. ``prepareApplication()`` sets `NSApplication`'s activation policy to
///      `.prohibited` **before any window exists**. A prohibited app cannot
///      become active, has no Dock tile, and no menu bar — the AppKit-level
///      guarantee that the test process cannot take focus.
///   2. The window is never ordered in. `NSWindow` allocates a window *device*
///      at `init` (`defer: false`, so the backing store exists and the view
///      tree can lay out and draw), but a window only becomes visible when
///      something calls `orderFront`, `makeKeyAndOrderFront`, or `orderFrontRegardless`.
///      Nothing in this file does, and `isExcludedFromWindowsMenu` plus a
///      borderless style leave it with no presence to order in.
///   3. The pixels come from ``NSView/cacheDisplay(in:to:)``, which draws the
///      view tree into a bitmap this process owns. It reads no framebuffer and
///      needs no screen-recording permission, so `screencapture`, `osascript`,
///      and System Events never enter the picture.
///
/// A window is used at all — rather than a bare `NSHostingView` — because
/// `List` is `NSTableView` underneath, and an AppKit view outside a window
/// hierarchy does not complete layout. `ImageRenderer` was the alternative and
/// is not usable for the same reason: it rasterizes SwiftUI's own drawing and
/// renders nothing for `NSViewRepresentable`-backed content, which is most of
/// what this app's Today screen is made of.
///
/// ## Determinism
///
/// Size and scale are arguments, never inherited: the caller states the point
/// size, ``scale`` is pinned at 2 rather than read from the machine's screen,
/// and the appearance is set explicitly on both the AppKit and the SwiftUI side
/// rather than following the developer's System Settings. The one thing that is
/// deliberately *not* pinned is the accent colour, which is a per-user setting
/// AppKit resolves inside `Color.accentColor`; that is worth knowing before
/// these images ever become golden files.
@MainActor
enum OffscreenSnapshot {
    /// Points to pixels. Pinned rather than read from `NSScreen`, so a
    /// developer on a non-Retina display produces the same image as everyone
    /// else.
    static let scale: CGFloat = 2

    /// Where the PNGs land: `.build/snapshots`, which is gitignored.
    ///
    /// Derived from `#filePath` rather than the process's working directory,
    /// which `swift test` does not promise anything about.
    static let directory: URL = URL(filePath: #filePath)
        .deletingLastPathComponent()  // Support
        .deletingLastPathComponent()  // TaskNotesMacTests
        .deletingLastPathComponent()  // Tests
        .deletingLastPathComponent()  // the package root
        .appending(path: ".build/snapshots")

    /// Render `view` and write it to `.build/snapshots/<name>.<appearance>.png`.
    ///
    /// - Parameters:
    ///   - view: the view to render. It is given an opaque window-coloured
    ///     backing, because a SwiftUI view's own background is usually
    ///     transparent and a transparent PNG is indistinguishable from a
    ///     failed render.
    ///   - name: the file's stem. The appearance is appended.
    ///   - size: the render size, in points.
    ///   - appearance: light or dark. Set on the window, the hosting view, and
    ///     the SwiftUI environment.
    /// - Returns: what was written, including the check that it is not blank.
    /// - Throws: ``Failure`` when the bitmap or the PNG encoding is refused, or
    ///   when the file cannot be written.
    static func write(
        _ view: some View,
        named name: String,
        size: CGSize,
        appearance: SnapshotAppearance
    ) throws -> RenderedSnapshot {
        let rep = try render(view, size: size, appearance: appearance)
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

    // ── Rendering ──────────────────────────────────────────────────────────

    private static func render(
        _ view: some View,
        size: CGSize,
        appearance: SnapshotAppearance
    ) throws -> NSBitmapImageRep {
        prepareApplication()

        let nsAppearance = NSAppearance(named: appearance.appearanceName)
        let hosting = NSHostingView(
            rootView:
                view
                .environment(\.colorScheme, appearance.colorScheme)
                .frame(width: size.width, height: size.height)
                // Opaque, and from the semantic palette rather than a literal,
                // so the two appearances differ here for exactly the reason
                // they differ in the app.
                .background(Color(nsColor: .windowBackgroundColor))
        )
        hosting.frame = CGRect(origin: .zero, size: size)
        hosting.appearance = nsAppearance

        // Borderless and never ordered in. See the type's documentation: the
        // window exists so `NSTableView` has a hierarchy to lay out in, not so
        // anybody can look at it.
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

        settle(hosting)

        let rep = try bitmap(size: size)
        hosting.cacheDisplay(in: hosting.bounds, to: rep)
        window.contentView = nil
        window.close()
        return rep
    }

    /// Give AppKit and SwiftUI the passes they need before the tree is stable.
    ///
    /// SwiftUI resolves a hosting view's layout on the next run-loop turn, and
    /// `NSTableView` populates its rows on the one after that. Without this the
    /// image is a correctly sized, correctly coloured, completely empty
    /// rectangle — which is why every snapshot is also checked for uniformity.
    ///
    /// A bounded number of turns rather than a sleep: this yields to the main
    /// run loop and returns as soon as it has nothing left to do.
    private static func settle(_ hosting: NSHostingView<some View>) {
        for _ in 0..<8 {
            hosting.layoutSubtreeIfNeeded()
            hosting.displayIfNeeded()
            RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.02))
        }
        hosting.layoutSubtreeIfNeeded()
        hosting.displayIfNeeded()
    }

    /// An empty bitmap at ``scale``, sized in pixels and described in points.
    ///
    /// Built by hand rather than with `bitmapImageRepForCachingDisplay(in:)`,
    /// which takes its scale from the window's backing store and therefore from
    /// whichever display the developer happens to have. Setting `size` in points
    /// on a bitmap whose pixel dimensions are twice that is what tells
    /// `cacheDisplay(in:to:)` to draw at 2×.
    ///
    /// ⚠️ **The one `unsafe` in authored Swift in this package, and why it
    /// stands.** `TaskNotesServerProcess.reserveEphemeralPort` sets the house
    /// rule: marking an expression `unsafe` compiles, but using an API that is
    /// not unsafe in the first place is better. That rule applies where a safe
    /// alternative exists — there it was `NWListener` instead of
    /// `sockaddr_in`. Here there is none. `NSBitmapImageRep` offers exactly one
    /// initializer that allocates an empty bitmap at chosen pixel dimensions,
    /// its `bitmapDataPlanes` parameter is
    /// `UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>?`, and `nil` is the
    /// documented spelling of *"allocate and own the buffer yourself"*. No
    /// pointer is formed, dereferenced, stored, or outlived by anything here.
    ///
    /// The safe alternative, `bitmapImageRepForCachingDisplay(in:)`, takes its
    /// scale from the window's backing store and therefore from whichever
    /// display the developer happens to have — so it trades one checked `nil`
    /// for images whose resolution depends on the machine that made them, which
    /// is the one property a snapshot layer cannot give up.
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

    /// How many distinct colours a coarse grid over the image lands on.
    ///
    /// The blank check, and the reason it is a count rather than a boolean: a
    /// render that failed produces exactly one colour, and knowing *how many*
    /// turned up makes "the window background plus one line of text" tellable
    /// from "the whole screen".
    ///
    /// Deliberately a sampled grid read through `colorAt(x:y:)` rather than the
    /// raw buffer: `bitmapData` is an `UnsafeMutablePointer`, and this package
    /// builds with strict memory safety on.
    private static func distinctColors(in rep: NSBitmapImageRep) -> Int {
        let strideX = max(1, rep.pixelsWide / 40)
        let strideY = max(1, rep.pixelsHigh / 40)
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

    // ── The application ────────────────────────────────────────────────────

    /// Bring `NSApplication` up in the one policy that cannot steal focus.
    ///
    /// `.prohibited` is the agent-without-UI policy: no Dock tile, no menu bar,
    /// and `activate()` does nothing. Setting it before any window exists is
    /// what makes "this test cannot interrupt the person using the Mac" a
    /// property of the process rather than of the code's good manners.
    private static func prepareApplication() {
        let app = NSApplication.shared
        guard app.activationPolicy() != .prohibited else { return }
        app.setActivationPolicy(.prohibited)
    }

    /// What can go wrong on the way from a view to a file.
    ///
    /// The bitmap case carries its own dimensions rather than reading
    /// ``scale``: `description` satisfies a nonisolated protocol requirement
    /// and cannot reach a main-actor-isolated static, and pushing the numbers
    /// into the payload is the fix that keeps the pin where it belongs — one
    /// constant, read once, at render time.
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

/// Which system appearance a snapshot is rendered in.
///
/// Both are always rendered. The definition of done forbids an in-app
/// appearance toggle — the app follows the system, semantic colours and all —
/// so a review that only ever saw one of them would be reviewing half the app.
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

/// One written PNG, and enough about it to tell a real render from a blank one.
struct RenderedSnapshot: Sendable {
    let url: URL
    let byteCount: Int
    let pixelSize: CGSize
    /// How many distinct colours a sampled grid over the image found. One means
    /// a flat rectangle, which is what a failed render looks like.
    let distinctColors: Int

    /// The line the test prints, so the paths can be read out of the test log.
    var reportLine: String {
        let pixels = "\(Int(pixelSize.width))×\(Int(pixelSize.height))px"
        return "snapshot  \(url.path(percentEncoded: false))  \(pixels)  "
            + "\(byteCount) bytes  \(distinctColors) colours"
    }
}
