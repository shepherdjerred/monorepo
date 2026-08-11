import AppKit
import Foundation
import SwiftUI
import Testing

/// Render a view, write it, say where it went, and check it is not blank.
///
/// The three assertions are the whole safety net at this stage. There are no
/// golden files yet — committing binaries before a human has agreed the design
/// is right would freeze an unreviewed screen — so what is enforced is only
/// that the renderer produced a real image: the right pixel dimensions, more
/// than one colour, and a plausible size. A blank render is the failure mode
/// that matters, because it is silent: an offscreen `NSHostingView` that never
/// completed layout writes a perfectly valid, perfectly empty PNG.
@MainActor
func record(
    _ view: some View,
    named name: String,
    size: CGSize,
    appearance: SnapshotAppearance,
    sourceLocation: SourceLocation = #_sourceLocation
) throws {
    let written = try OffscreenSnapshot.write(
        view, named: name, size: size, appearance: appearance)
    try SnapshotLog.line(written.reportLine)

    #expect(
        written.pixelSize
            == CGSize(
                width: size.width * OffscreenSnapshot.scale,
                height: size.height * OffscreenSnapshot.scale),
        "\(name) was not rendered at \(OffscreenSnapshot.scale)×",
        sourceLocation: sourceLocation
    )
    #expect(
        written.distinctColors > 1,
        "\(name) is a flat rectangle — the view never rendered",
        sourceLocation: sourceLocation
    )
    #expect(
        written.byteCount > 1_000,
        "\(name) is \(written.byteCount) bytes, which is too small to hold a screen",
        sourceLocation: sourceLocation
    )
}

/// The test process's standard output.
///
/// `print` is banned package-wide — it is not logging — but these paths have to
/// reach a human reading `swift test` output, and a `Logger` goes to the unified
/// log rather than to the terminal in front of them. Writing the bytes is the
/// honest spelling of "this is program output, not a diagnostic".
enum SnapshotLog {
    static func line(_ text: String) throws {
        try FileHandle.standardOutput.write(contentsOf: Data("\(text)\n".utf8))
    }
}
