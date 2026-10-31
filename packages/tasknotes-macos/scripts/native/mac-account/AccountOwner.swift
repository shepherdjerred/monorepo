import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

struct Owner {
    let pid: pid_t
    let seconds: UInt64
    let microseconds: UInt64
    let launch: Double
    let root: AXUIElement
    let window: AXUIElement
    let anchorIdentifier: String
    let stage: String
    let mutating: Bool
    let expectedRequestID: UUID?
    init(pid: pid_t, stage: String, mutating: Bool, expectedRequestID: UUID?, anchor: String? = nil)
        throws
    {
        self.pid = pid
        self.stage = stage
        self.mutating = mutating
        self.expectedRequestID = expectedRequestID
        try requireUnlockedSession()
        phase = "bind-process"
        var info = proc_bsdinfo()
        let count = Int32(MemoryLayout<proc_bsdinfo>.size)
        var programPath = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, count) == count,
            info.pbi_uid == geteuid(), info.pbi_ruid == getuid(),
            proc_pidpath(pid, &programPath, UInt32(programPath.count)) > 0,
            String(cString: programPath) == executable,
            let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated,
            app.bundleIdentifier == "red.sjer.tasknotes.mac.acceptance",
            app.executableURL?.resolvingSymlinksInPath().path == executable,
            let date = app.launchDate
        else { throw Failure.process }
        seconds = info.pbi_start_tvsec
        microseconds = info.pbi_start_tvusec
        launch = date.timeIntervalSince1970
        root = AXUIElementCreateApplication(pid)
        guard AXUIElementSetMessagingTimeout(root, 0.5) == .success,
            let windows = attr(root, "AXWindows") as? [AXUIElement]
        else { throw Failure.window }
        let identifier =
            anchor
            ?? (stage == "credentials"
                ? "facet.account.email"
                : stage == "verification" ? "facet.account.code" : "facet.account.vault-password")
        anchorIdentifier = identifier
        window = try Self.selectWindow(
            root: root, windows: windows, anchor: anchor, identifier: identifier, pid: pid)
        _ = try validate()
    }
    private static func selectWindow(
        root: AXUIElement, windows: [AXUIElement], anchor: String?, identifier: String, pid: pid_t
    ) throws -> AXUIElement {
        let candidates: [AXUIElement]
        if anchor != nil {
            guard let value = attr(root, "AXMainWindow"),
                CFGetTypeID(value) == AXUIElementGetTypeID(),
                let main = windows.first(where: { CFEqual($0, value) }),
                let windowID = attr(main, "AXIdentifier") as? String,
                windowID.hasPrefix("facet.workspace."),
                let uuid = UUID(uuidString: String(windowID.dropFirst("facet.workspace.".count))),
                windowID == "facet.workspace.\(uuid.uuidString.lowercased())",
                try matches(main, identifier: identifier).count == 1
            else { throw Failure.window }
            var windowPID: pid_t = 0
            guard AXUIElementGetPid(main, &windowPID) == .success, windowPID == pid else {
                throw Failure.window
            }
            candidates = [main]
        } else {
            candidates = try windows.filter { try matches($0, identifier: identifier).count == 1 }
        }
        guard candidates.count == 1, let owned = candidates.first,
            attr(owned, "AXRole") as? String == "AXWindow"
        else { throw Failure.window }
        return owned
    }
    func focusedWindowIsOwned() throws -> Bool {
        guard let value = attr(root, "AXFocusedWindow"),
            CFGetTypeID(value) == AXUIElementGetTypeID()
        else { return false }
        if CFEqual(value, window) { return true }
        let sheets =
            (attr(window, "AXSheets") as? [AXUIElement] ?? [])
            + (attr(window, "AXChildren") as? [AXUIElement] ?? [])
        guard let focused = sheets.first(where: { CFEqual(value, $0) }) else { return false }
        var focusedPID: pid_t = 0
        guard AXUIElementGetPid(focused, &focusedPID) == .success, focusedPID == pid,
            attr(focused, "AXRole") as? String == "AXSheet",
            same(attr(focused, "AXParent"), window)
        else { return false }
        let hostAnchors = try matches(window, identifier: anchorIdentifier)
        let sheetAnchors = try matches(focused, identifier: anchorIdentifier)
        return hostAnchors.count == 1 && sheetAnchors.count == 1
            && CFEqual(hostAnchors[0], sheetAnchors[0])
    }
    func validate() throws -> [String: Any] {
        try validateOwnership()
        return try validateStatus(
            stage: stage, launch: launch, expectedRequestID: expectedRequestID)
    }
    func validateOwnership() throws {
        try requireUnlockedSession()
        phase = "process"
        var info = proc_bsdinfo()
        let count = Int32(MemoryLayout<proc_bsdinfo>.size)
        var path = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, count) == count,
            info.pbi_uid == geteuid(), info.pbi_ruid == getuid(),
            info.pbi_start_tvsec == seconds, info.pbi_start_tvusec == microseconds,
            proc_pidpath(pid, &path, UInt32(path.count)) > 0, String(cString: path) == executable,
            let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated,
            app.bundleIdentifier == "red.sjer.tasknotes.mac.acceptance",
            app.executableURL?.resolvingSymlinksInPath().path == executable,
            app.launchDate?.timeIntervalSince1970 == launch
        else { throw Failure.process }
        phase = "window"
        guard let windows = attr(root, "AXWindows") as? [AXUIElement],
            windows.contains(where: { CFEqual($0, window) })
        else { throw Failure.window }
        if ["facet.settings.open", "facet.onboarding.sync"].contains(anchorIdentifier) {
            guard same(attr(root, "AXMainWindow"), window) else { throw Failure.window }
        }
        if mutating {
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
                try focusedWindowIsOwned()
            else { throw Failure.window }
        }
        try validateManifest()
    }

    func element(
        _ identifier: String, role: String, secure: Bool = false, alternateRoles: Set<String> = []
    ) throws -> AXUIElement {
        _ = try validate()
        let found = try matches(window, identifier: identifier)
        guard found.count == 1, let target = found.first else { throw Failure.field }
        var targetPID: pid_t = 0
        guard AXUIElementGetPid(target, &targetPID) == .success, targetPID == pid,
            let actualRole = attr(target, "AXRole") as? String,
            actualRole == role || alternateRoles.contains(actualRole),
            attr(target, "AXIdentifier") as? String == identifier,
            same(attr(target, "AXWindow"), window),
            !secure || attr(target, "AXSubrole") as? String == "AXSecureTextField"
        else { throw Failure.field }
        return target
    }
    func presentLifecycleAccount() throws {
        guard lifecycle != nil else { throw Failure.run }
        _ = try validate()
        guard let app = NSRunningApplication(processIdentifier: pid) else { throw Failure.process }
        _ = app.activate(options: [])
        _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        _ = try validate()
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
            try focusedWindowIsOwned()
        else { throw Failure.window }
        let menu = try element(
            "facet.settings.open", role: "AXMenuButton",
            alternateRoles: ["AXButton", "AXPopUpButton"])
        guard attr(menu, "AXEnabled") as? Bool == true,
            AXUIElementPerformAction(menu, kAXPressAction as CFString) == .success
        else { throw Failure.action }
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        _ = try validate()
        let items = try matches(menu, identifier: "facet.account.open")
        guard items.count == 1, let item = items.first else { throw Failure.field }
        var itemPID: pid_t = 0
        guard AXUIElementGetPid(item, &itemPID) == .success, itemPID == pid,
            let role = attr(item, "AXRole") as? String, ["AXMenuItem", "AXButton"].contains(role),
            attr(item, "AXEnabled") as? Bool == true,
            NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
        else { throw Failure.field }
        let result = AXUIElementPerformAction(item, kAXPressAction as CFString)
        emit([
            "runID": runID, "normalNavigationPressCount": 2, "normalAXPressResult": result.rawValue,
            "submitActionCount": 0,
        ])
        guard result == .success else { throw Failure.action }
    }
}

extension Owner {
    func set(
        _ identifier: String, value: String, secure: Bool = false,
        requireLive: () throws -> Void = {}
    ) throws {
        try requireLive()
        let target = try element(identifier, role: "AXTextField", secure: secure)
        guard attr(target, "AXEnabled") as? Bool == true else { throw Failure.field }
        guard value.utf8.count <= 512,
            !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw Failure.input }
        _ = try validate()
        guard
            AXUIElementSetAttributeValue(target, "AXFocused" as CFString, kCFBooleanTrue)
                == .success
        else { throw Failure.setter }
        func exactFocusedField() throws {
            try requireLive()
            _ = try validate()
            let current = try element(identifier, role: "AXTextField", secure: secure)
            guard CFEqual(current, target), attr(current, "AXEnabled") as? Bool == true,
                attr(current, "AXFocused") as? Bool == true,
                same(attr(root, "AXFocusedUIElement"), current)
            else { throw Failure.field }
        }
        func pair(key: CGKeyCode, flags: CGEventFlags = [], unicode: [UniChar] = []) throws {
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true),
                let up = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false)
            else { throw Failure.action }
            down.flags = flags
            up.flags = flags
            if !unicode.isEmpty {
                unicode.withUnsafeBufferPointer { text in
                    down.keyboardSetUnicodeString(
                        stringLength: text.count, unicodeString: text.baseAddress)
                    up.keyboardSetUnicodeString(
                        stringLength: text.count, unicodeString: text.baseAddress)
                }
            }
            try exactFocusedField()
            down.postToPid(pid)
            up.postToPid(pid)
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
            try exactFocusedField()
        }
        try pair(key: 0, flags: .maskCommand)
        try pair(key: 51)
        for scalar in value.unicodeScalars {
            try pair(key: 0, unicode: Array(String(scalar).utf16))
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        try exactFocusedField()
    }
    func wait(_ identifier: String, enabled: Bool) throws {
        let deadline = Date().addingTimeInterval(2)
        repeat {
            if attr(try element(identifier, role: "AXButton"), "AXEnabled") as? Bool == enabled {
                return
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        } while Date() < deadline
        throw Failure.field
    }
    func press(
        _ identifier: String, emitReceipt: Bool = true, requireLive: () throws -> Void = {}
    ) throws {
        try requireLive()
        let button = try element(identifier, role: "AXButton")
        guard attr(button, "AXEnabled") as? Bool == true else { throw Failure.field }
        _ = try validate()
        try requireLive()
        submitCount += 1
        let outcome = AXUIElementPerformAction(button, kAXPressAction as CFString)
        if emitReceipt {
            emit([
                "runID": runID, "submitActionCount": submitCount,
                "normalAXPressResult": outcome.rawValue,
            ])
        }
        guard outcome == .success else { throw Failure.action }
    }
}
