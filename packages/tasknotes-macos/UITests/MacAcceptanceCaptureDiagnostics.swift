#if os(macOS)
    import AppKit
    import ApplicationServices
    import Foundation
    import XCTest

    extension MacAcceptanceCapture {
        enum CaptureError: Error {
            case descriptor, process, window, dimensions, permission, capture, timeout
            case geometry(String)
            case sessionUnavailable(phase: CapturePhase)
            case sessionOffConsole(phase: CapturePhase)
            case sessionLocked(phase: CapturePhase)
            case applicationState(phase: CapturePhase, rawValue: UInt)
            case alertCount(phase: CapturePhase, count: Int)
            case secureFieldCount(phase: CapturePhase, count: Int)
            case forbiddenControl(phase: CapturePhase, index: Int)
            case foregroundMismatch(
                expectedPID: pid_t, actualForegroundPID: pid_t?, phase: CapturePhase)
        }

        enum CapturePhase {
            case beforeActivation, afterActivation, beforeCapture, afterCapture, afterDecode
        }
    }

    /// Bounded state evidence only: never retain foreign app names, UI text or pixels.
    @MainActor
    final class MacAcceptanceCaptureDiagnostics {
        private enum Flag: String, Encodable { case yes, no, unavailable }
        private struct Sample: Encodable {
            let phase: String
            let elapsedSeconds: Double
            let applicationState: UInt
            let foregroundPID: pid_t?
            let foregroundMatchesOwner: Bool
            let ownerActive: Flag
            let onConsole: Flag
            let sessionLocked: Flag
        }
        private struct Report: Encodable {
            let schemaVersion = 1
            let ownerPID: pid_t
            let ownerStartSeconds: UInt64
            let ownerStartMicroseconds: UInt64
            let samples: [Sample]
            let omittedSamples: Int
        }
        private let ownerPID: pid_t
        private let startSeconds: UInt64
        private let startMicroseconds: UInt64
        private let started = ContinuousClock.now
        private var samples: [Sample] = []
        private var omittedSamples = 0

        init(ownerPID: pid_t, startSeconds: UInt64, startMicroseconds: UInt64) {
            self.ownerPID = ownerPID
            self.startSeconds = startSeconds
            self.startMicroseconds = startMicroseconds
        }

        func observe(_ phase: String, app: XCUIApplication) {
            guard samples.count < 64 else {
                omittedSamples += 1
                return
            }
            let elapsed = started.duration(to: ContinuousClock.now).components
            let foreground = NSWorkspace.shared.frontmostApplication?.processIdentifier
            let owner = NSRunningApplication(processIdentifier: ownerPID)
            let session = CGSessionCopyCurrentDictionary() as? [String: Any]
            samples.append(
                Sample(
                    phase: phase,
                    elapsedSeconds: Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18,
                    applicationState: app.state.rawValue, foregroundPID: foreground,
                    foregroundMatchesOwner: foreground == ownerPID,
                    ownerActive: owner.map { $0.isActive ? .yes : .no } ?? .unavailable,
                    onConsole: Self.flag(session?["kCGSSessionOnConsoleKey"]),
                    sessionLocked: Self.flag(session?["CGSSessionScreenIsLocked"])))
        }

        func retain(test: XCTestCase, name: String) {
            let report = Report(
                ownerPID: ownerPID, ownerStartSeconds: startSeconds,
                ownerStartMicroseconds: startMicroseconds, samples: samples,
                omittedSamples: omittedSamples)
            switch Result(catching: { try JSONEncoder().encode(report) }) {
            case .success(let data):
                let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
                attachment.name = "Capture state diagnostics — \(name)"
                attachment.lifetime = .keepAlways
                test.add(attachment)
            case .failure:
                XCTFail("The bounded capture state evidence could not be encoded.")
            }
        }

        private static func flag(_ value: Any?) -> Flag {
            guard let flag = value as? Bool else { return .unavailable }
            return flag ? .yes : .no
        }
    }
#endif
