#if os(macOS)
    import AppKit
    import Darwin
    import Foundation
    import ScreenCaptureKit
    import Synchronization
    import XCTest

    /// Only explicitly selected synthetic workspace windows may become retained evidence.
    /// Each ScreenCaptureKit filter captures one owned window, never the desktop stack.
    @MainActor
    enum MacAcceptanceCapture {
        private enum CaptureError: Error {
            case descriptor, process, unsafeInterface, window, dimensions, permission, capture,
                timeout
            case geometry(String)
            case foregroundMismatch(
                expectedPID: pid_t, actualForegroundPID: pid_t?, phase: CapturePhase)
        }

        private enum CapturePhase {
            case beforeActivation, afterActivation, beforeCapture, afterCapture, afterDecode
        }

        private struct Descriptor: Decodable {
            let schemaVersion: Int
            let runID: UUID
            let stateDirectory: String
        }

        static func attach(
            app: XCUIApplication, name: String, test: XCTestCase, windows: [XCUIElement]
        ) async throws {
            try Task.checkCancellation()
            guard !windows.isEmpty,
                Set(windows.map(\.identifier)).count == windows.count
            else { throw CaptureError.window }
            try unlockedSession()
            guard CGPreflightScreenCaptureAccess() else { throw CaptureError.permission }
            let owner = try process(app, foreground: false, phase: .beforeActivation)
            app.activate()
            guard try process(app, phase: .afterActivation) == owner else {
                throw CaptureError.process
            }
            for (index, window) in windows.enumerated() {
                try safeInterface(app)
                try validateWindow(window, app: app)
                let snapshot = try snapshot(window, pid: owner.pid)
                let baseName = windows.count == 1 ? name : "\(name) — window \(index + 1)"
                for (surfaceIndex, surface) in snapshot.surfaces.enumerated() {
                    try validate(
                        snapshot, window: window, app: app, owner: owner, phase: .beforeCapture)
                    let scale = try visibleScale(surface.frame)
                    let deadline = ContinuousClock.now.advanced(by: .seconds(10))
                    let png = try await capture(surface, scale: scale, deadline: deadline)
                    try validate(
                        snapshot, window: window, app: app, owner: owner, phase: .afterCapture)
                    guard let image = NSBitmapImageRep(data: png),
                        abs(Double(image.pixelsWide) - (surface.frame.width * scale).rounded())
                            <= 1,
                        abs(Double(image.pixelsHigh) - (surface.frame.height * scale).rounded())
                            <= 1
                    else { throw CaptureError.dimensions }
                    try validate(
                        snapshot, window: window, app: app, owner: owner, phase: .afterDecode)
                    let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
                    attachment.name =
                        surfaceIndex == 0 ? baseName : "\(baseName) — sheet \(surfaceIndex)"
                    attachment.lifetime = .keepAlways
                    try Task.checkCancellation()
                    test.add(attachment)
                }
            }
        }

        private static func unlockedSession() throws {
            guard let session = CGSessionCopyCurrentDictionary() as? [String: Any],
                session["kCGSSessionOnConsoleKey"] as? Bool == true,
                session["CGSSessionScreenIsLocked"] as? Bool != true
            else { throw CaptureError.unsafeInterface }
        }

        private static func safeInterface(_ app: XCUIApplication) throws {
            try unlockedSession()
            let forbidden = [
                "facet.account.email", "facet.account.password", "facet.account.code",
                "facet.account.vault-password", "facet.account.signin", "facet.account.error",
            ]
            guard app.state == .runningForeground, app.alerts.count == 0,
                app.secureTextFields.count == 0,
                !forbidden.contains(where: {
                    app.descendants(matching: .any).matching(identifier: $0).count > 0
                })
            else { throw CaptureError.unsafeInterface }
        }

        private static func validateWindow(_ window: XCUIElement, app: XCUIApplication) throws {
            let identifier = window.identifier
            let prefix = "facet.workspace."
            guard identifier.hasPrefix(prefix),
                let uuid = UUID(uuidString: String(identifier.dropFirst(prefix.count))),
                identifier == prefix + uuid.uuidString.lowercased(),
                window.exists, window.elementType == .window,
                app.windows.matching(identifier: identifier).count == 1
            else { throw CaptureError.window }
        }

        private struct ProcessOwner: Equatable {
            let pid: pid_t
            let seconds: UInt64
            let microseconds: UInt64
            let launch: Date
        }

        private static func process(
            _ app: XCUIApplication, foreground: Bool = true, phase: CapturePhase
        ) throws -> ProcessOwner {
            let environment = ProcessInfo.processInfo.environment
            guard let path = environment["FACET_E2E_DESCRIPTOR"],
                let runID = environment["FACET_E2E_RUN_ID"].flatMap(UUID.init(uuidString:))
            else { throw CaptureError.descriptor }
            let descriptor = try JSONDecoder().decode(
                Descriptor.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
            _ = try MacAcceptanceOwnership.validate(
                descriptor: path, stateDirectory: descriptor.stateDirectory, runID: runID)
            guard descriptor.schemaVersion == 1, descriptor.runID == runID,
                app.launchArguments == ["--facet-acceptance-descriptor", path]
                    || app.launchArguments == [
                        "--facet-acceptance-descriptor", path, "--facet-native-acceptance",
                    ]
            else { throw CaptureError.descriptor }
            let package = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
                .deletingLastPathComponent()
            let build: URL
            if app.launchArguments.contains("--facet-native-acceptance") {
                build = package.appendingPathComponent(".build/acceptance-xcode")
            } else {
                build = package.deletingLastPathComponent().appendingPathComponent(
                    "tasks-for-obsidian/.build/live-sync/\(runID.uuidString.lowercased())/macos")
            }
            let executable = build.appendingPathComponent(
                "Build/Products/Debug/FacetAcceptance.app/Contents/MacOS/FacetAcceptance")
            let applications = NSRunningApplication.runningApplications(
                withBundleIdentifier: "red.sjer.tasknotes.mac.acceptance"
            ).filter { !$0.isTerminated }
            guard executable.resolvingSymlinksInPath() == executable,
                applications.count == 1, let application = applications.first,
                application.executableURL?.resolvingSymlinksInPath() == executable,
                !application.isTerminated, let launch = application.launchDate
            else { throw CaptureError.process }
            if foreground {
                let actual = NSWorkspace.shared.frontmostApplication?.processIdentifier
                guard actual == application.processIdentifier else {
                    throw CaptureError.foregroundMismatch(
                        expectedPID: application.processIdentifier, actualForegroundPID: actual,
                        phase: phase)
                }
            }
            var info = proc_bsdinfo()
            let size = Int32(MemoryLayout<proc_bsdinfo>.size)
            let pid = application.processIdentifier
            guard unsafe proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
                info.pbi_uid == geteuid(), info.pbi_ruid == getuid()
            else { throw CaptureError.process }
            return ProcessOwner(
                pid: pid, seconds: info.pbi_start_tvsec,
                microseconds: info.pbi_start_tvusec, launch: launch)
        }
    }

    extension MacAcceptanceCapture {
        private struct NativeWindow: Encodable, Equatable, Sendable {
            let id: CGWindowID
            let pid: pid_t
            let layer: Int
            let alpha: Double
            let frame: CGRect
        }

        private struct GeometryFailure: Encodable {
            let phase: String
            let expectedPID: pid_t
            let expectedFrame: CGRect
            let ownedWindowCount: Int
            let ownedWindows: [NativeWindow]
        }

        private static func nativeWindows() throws -> [NativeWindow] {
            guard
                let records = CGWindowListCopyWindowInfo(
                    [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                    as? [[String: Any]]
            else { throw CaptureError.window }
            return try records.map { record in
                guard let id = record[kCGWindowNumber as String] as? NSNumber,
                    let pid = record[kCGWindowOwnerPID as String] as? NSNumber,
                    let layer = record[kCGWindowLayer as String] as? NSNumber,
                    let alpha = record[kCGWindowAlpha as String] as? NSNumber,
                    let bounds = record[kCGWindowBounds as String] as? NSDictionary,
                    let frame = CGRect(dictionaryRepresentation: bounds), id.uint32Value > 0
                else { throw CaptureError.window }
                return NativeWindow(
                    id: id.uint32Value, pid: pid.int32Value, layer: layer.intValue,
                    alpha: alpha.doubleValue, frame: frame)
            }
        }

        private static func geometryFailure(
            _ phase: String, frame: CGRect, pid: pid_t,
            windows: [NativeWindow]
        ) throws -> CaptureError {
            // Never retain titles, raw window lists, text values or image pixels.
            let owned = windows.filter { $0.pid == pid }
            let failure = GeometryFailure(
                phase: phase, expectedPID: pid, expectedFrame: frame, ownedWindowCount: owned.count,
                ownedWindows: Array(owned.prefix(16)))
            let bytes = try JSONEncoder().encode(failure)
            guard let text = String(data: bytes, encoding: .utf8) else { throw CaptureError.window }
            return .geometry(text)
        }

        private static func visibleScale(_ frame: CGRect) throws -> CGFloat {
            guard !frame.isEmpty, !frame.isInfinite, !frame.isNull,
                frame.origin.x.isFinite, frame.origin.y.isFinite,
                frame.width.isFinite, frame.height.isFinite
            else { throw CaptureError.dimensions }
            let displays = NSScreen.screens.filter { screen in
                guard
                    let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
                        as? NSNumber
                else { return false }
                return CGDisplayBounds(number.uint32Value).contains(frame)
            }
            guard displays.count == 1, let display = displays.first,
                display.backingScaleFactor > 0, display.backingScaleFactor.isFinite
            else { throw CaptureError.dimensions }
            return display.backingScaleFactor
        }

        private struct WorkspaceSnapshot {
            let identifier: String
            let surfaces: [NativeWindow]
        }

        private static func sheetFrames(_ window: XCUIElement) -> [CGRect] {
            window.sheets.allElementsBoundByIndex.map(\.frame).sorted {
                [$0.minX, $0.minY, $0.width, $0.height].lexicographicallyPrecedes(
                    [$1.minX, $1.minY, $1.width, $1.height])
            }
        }

        private static func snapshot(_ window: XCUIElement, pid: pid_t) throws -> WorkspaceSnapshot
        {
            let windows = try nativeWindows()
            let frames = [window.frame] + sheetFrames(window)
            let surfaces = try frames.map { frame in
                _ = try visibleScale(frame)
                guard window.frame.contains(frame) else { throw CaptureError.window }
                let matches = windows.filter {
                    $0.pid == pid && $0.layer == 0 && $0.frame == frame && $0.alpha > 0
                }
                guard matches.count == 1, let selected = matches.first else {
                    throw try geometryFailure(
                        "owned-target", frame: frame, pid: pid, windows: windows)
                }
                return selected
            }
            guard Set(surfaces.map(\.id)).count == surfaces.count else { throw CaptureError.window }
            return WorkspaceSnapshot(identifier: window.identifier, surfaces: surfaces)
        }

        private static func validate(
            _ snapshot: WorkspaceSnapshot, window: XCUIElement, app: XCUIApplication,
            owner: ProcessOwner, phase: CapturePhase
        ) throws {
            try Task.checkCancellation()
            try safeInterface(app)
            guard CGPreflightScreenCaptureAccess() else { throw CaptureError.permission }
            try validateWindow(window, app: app)
            guard window.identifier == snapshot.identifier,
                [window.frame] + sheetFrames(window) == snapshot.surfaces.map(\.frame)
            else { throw CaptureError.window }
            let current = try nativeWindows()
            for expected in snapshot.surfaces {
                guard current.filter({ $0 == expected }).count == 1 else {
                    throw try geometryFailure(
                        "changed-target", frame: expected.frame, pid: owner.pid, windows: current)
                }
            }
            guard try process(app, phase: phase) == owner else { throw CaptureError.process }
        }
    }

    extension MacAcceptanceCapture {
        private static func capture(
            _ surface: NativeWindow, scale: CGFloat, deadline: ContinuousClock.Instant
        ) async throws -> Data {
            try await bounded(deadline: deadline) { pending in
                SCShareableContent.getExcludingDesktopWindows(true, onScreenWindowsOnly: true) {
                    content, error in
                    guard pending.acceptsCallback else { return }
                    guard ContinuousClock.now < deadline else {
                        Task { @MainActor in pending.finish(.failure(CaptureError.timeout)) }
                        return
                    }
                    let matches = content?.windows.filter {
                        $0.windowID == surface.id && $0.owningApplication?.processID == surface.pid
                            && $0.frame == surface.frame && $0.isOnScreen
                    }
                    guard error == nil, matches?.count == 1, let window = matches?.first else {
                        Task { @MainActor in pending.finish(.failure(CaptureError.window)) }
                        return
                    }
                    guard CGPreflightScreenCaptureAccess() else {
                        Task { @MainActor in pending.finish(.failure(CaptureError.permission)) }
                        return
                    }
                    // Only PNG Data crosses actors; framework objects stay in native callbacks.
                    let configuration = SCStreamConfiguration()
                    configuration.width = Int((surface.frame.width * scale).rounded())
                    configuration.height = Int((surface.frame.height * scale).rounded())
                    configuration.includeChildWindows = false
                    configuration.ignoreShadowsSingleWindow = true
                    configuration.shouldBeOpaque = true
                    configuration.showsCursor = false
                    configuration.capturesAudio = false
                    configuration.captureMicrophone = false
                    let filter = SCContentFilter(desktopIndependentWindow: window)
                    SCScreenshotManager.captureImage(
                        contentFilter: filter, configuration: configuration
                    ) {
                        image, error in
                        guard pending.acceptsCallback else { return }
                        guard ContinuousClock.now < deadline else {
                            Task { @MainActor in pending.finish(.failure(CaptureError.timeout)) }
                            return
                        }
                        guard let image, error == nil,
                            let png = NSBitmapImageRep(cgImage: image).representation(
                                using: .png, properties: [:])
                        else {
                            Task { @MainActor in pending.finish(.failure(CaptureError.capture)) }
                            return
                        }
                        Task { @MainActor in pending.finish(.success(png)) }
                    }
                }
            }
        }

        private static func bounded<Value: Sendable>(
            deadline: ContinuousClock.Instant, start: (PendingCapture<Value>) -> Void
        ) async throws -> Value {
            let pending = PendingCapture<Value>(deadline: deadline)
            return try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    pending.begin(continuation)
                    if Task.isCancelled { pending.finish(.failure(CancellationError())) }
                    if pending.isActive { start(pending) }
                }
            } onCancel: {
                Task { @MainActor in pending.finish(.failure(CancellationError())) }
            }
        }

        /// The caller does not await the native callback on timeout. Late results only release memory.
        @MainActor
        private final class PendingCapture<Value: Sendable> {
            nonisolated private let accepting = Mutex(true)
            private let deadline: ContinuousClock.Instant
            private var continuation: CheckedContinuation<Value, any Error>?
            private var timer: Task<Void, Never>?
            private var result: Result<Value, any Error>?

            init(deadline: ContinuousClock.Instant) { self.deadline = deadline }

            var isActive: Bool { result == nil && ContinuousClock.now < deadline }
            nonisolated var acceptsCallback: Bool { accepting.withLock { $0 } }

            func begin(_ continuation: CheckedContinuation<Value, any Error>) {
                if let result {
                    continuation.resume(with: result)
                    return
                }
                self.continuation = continuation
                timer = Task { @MainActor [weak self, deadline] in
                    do { try await Task.sleep(until: deadline, clock: .continuous) } catch {
                        return
                    }
                    self?.finish(.failure(CaptureError.timeout))
                }
            }

            func finish(_ value: Result<Value, any Error>) {
                guard result == nil else { return }
                accepting.withLock { $0 = false }
                let resolved: Result<Value, any Error> =
                    ContinuousClock.now < deadline ? value : .failure(CaptureError.timeout)
                result = resolved
                timer?.cancel()
                timer = nil
                continuation?.resume(with: resolved)
                continuation = nil
            }
        }
    }
#endif
