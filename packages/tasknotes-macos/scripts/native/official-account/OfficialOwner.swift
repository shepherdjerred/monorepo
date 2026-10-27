import AppKit
import ApplicationServices
import CryptoKit
import Darwin
import Foundation

enum GuardFailure: Error { case input, binding, process, session, form, focus, delivery }
var inputPhase = "input"

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
}

func sameElement(_ value: CFTypeRef?, _ target: AXUIElement) -> Bool {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return false }
    return CFEqual(value, target)
}

func descendants(_ root: AXUIElement) throws -> [AXUIElement] {
    var queue = [root]
    var found: [AXUIElement] = []
    var index = 0
    while index < queue.count {
        guard index < 2000 else { throw GuardFailure.form }
        let current = queue[index]
        index += 1
        if found.contains(where: { CFEqual($0, current) }) { continue }
        found.append(current)
        queue += attribute(current, "AXChildren") as? [AXUIElement] ?? []
        queue += attribute(current, "AXSheets") as? [AXUIElement] ?? []
    }
    return found
}

func ownedJSON(_ file: String) throws -> [String: Any] {
    let metadata = try FileManager.default.attributesOfItem(atPath: file)
    guard URL(fileURLWithPath: file).resolvingSymlinksInPath().path == file,
        metadata[.type] as? FileAttributeType == .typeRegular,
        (metadata[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
        let size = metadata[.size] as? NSNumber, size.intValue <= 65536,
        let result = try JSONSerialization.jsonObject(
            with: Data(contentsOf: URL(fileURLWithPath: file)))
            as? [String: Any]
    else { throw GuardFailure.binding }
    return result
}

struct OfficialOwner {
    let pid: pid_t
    let executable: String
    let referenceDirectory: String
    let seconds: UInt64
    let microseconds: UInt64
    let launchDate: Double
    let formBinding: String
    let root: AXUIElement
    let window: AXUIElement

    init(_ input: [String: Any]) throws {
        guard let rawPID = input["pid"] as? Int, rawPID > 0, rawPID <= Int(Int32.max),
            let program = input["executable"] as? String,
            let reference = input["referenceDirectory"] as? String,
            let exportID = input["officialExportID"] as? String,
            UUID(uuidString: exportID)?.uuidString.lowercased() == exportID,
            program == FileManager.default.homeDirectoryForCurrentUser.path
                + "/Applications/FacetAcceptanceReference/" + exportID
                + "/Obsidian.app/Contents/MacOS/Obsidian"
        else { throw GuardFailure.binding }
        self.pid = pid_t(rawPID)
        self.executable = program
        self.referenceDirectory = reference
        var info = proc_bsdinfo()
        guard
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
                == Int32(MemoryLayout<proc_bsdinfo>.size),
            let app = NSRunningApplication(processIdentifier: pid), let date = app.launchDate
        else { throw GuardFailure.process }
        seconds = info.pbi_start_tvsec
        microseconds = info.pbi_start_tvusec
        launchDate = date.timeIntervalSince1970
        guard let run = input["runID"] as? String else { throw GuardFailure.input }
        let config = input["configSHA256"] as? String ?? "probe"
        formBinding = "\(run):\(config):\(rawPID):\(seconds):\(microseconds):\(launchDate)"
        root = AXUIElementCreateApplication(pid)
        guard AXUIElementSetMessagingTimeout(root, 0.5) == .success,
            let windows = attribute(root, "AXWindows") as? [AXUIElement]
        else { throw GuardFailure.form }
        let candidates = try windows.filter { candidate in
            let fields = try descendants(candidate).filter {
                attribute($0, "AXPlaceholderValue") as? String == "Your email..."
            }
            return fields.count == 1
        }
        guard candidates.count == 1, let selectedWindow = candidates.first else {
            throw GuardFailure.form
        }
        self.window = selectedWindow
        try validate()
    }

    func validate() throws {
        guard let session = CGSessionCopyCurrentDictionary() as? [String: Any],
            session["kCGSSessionOnConsoleKey"] as? Bool == true,
            session["CGSSessionScreenIsLocked"] as? Bool != true
        else { throw GuardFailure.session }
        var info = proc_bsdinfo()
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout<proc_bsdinfo>.size))
                == Int32(MemoryLayout<proc_bsdinfo>.size),
            info.pbi_uid == geteuid(), info.pbi_ruid == getuid(),
            info.pbi_start_tvsec == seconds, info.pbi_start_tvusec == microseconds,
            proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0,
            String(cString: buffer) == executable,
            let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated,
            app.bundleIdentifier == "md.obsidian",
            app.executableURL?.resolvingSymlinksInPath().path == executable,
            app.launchDate?.timeIntervalSince1970 == launchDate,
            let windows = attribute(root, "AXWindows") as? [AXUIElement],
            windows.contains(where: { CFEqual($0, window) })
        else { throw GuardFailure.process }
    }

    func field(_ placeholder: String, secure: Bool) throws -> AXUIElement {
        try validate()
        let fields = try descendants(window).filter {
            attribute($0, "AXPlaceholderValue") as? String == placeholder
                && attribute($0, "AXRole") as? String == "AXTextField"
        }
        guard fields.count == 1, let field = fields.first,
            attribute(field, "AXEnabled") as? Bool == true,
            sameElement(attribute(field, "AXWindow"), window),
            (attribute(field, "AXSubrole") as? String == "AXSecureTextField") == secure
        else { throw GuardFailure.form }
        return field
    }

    func activate() throws {
        try validate()
        guard let app = NSRunningApplication(processIdentifier: pid) else {
            throw GuardFailure.process
        }
        _ = app.activate(options: [])
        _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        try requireForeground()
    }

    func requireForeground() throws {
        try validate()
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
            sameElement(attribute(root, "AXFocusedWindow"), window)
        else { throw GuardFailure.focus }
    }

    func loginEnabled() throws -> Bool {
        let email = try field("Your email...", secure: false)
        var parent: AXUIElement = email
        for _ in 0..<12 {
            let nodes = try descendants(parent)
            let buttons = nodes.filter {
                attribute($0, "AXRole") as? String == "AXButton"
                    && attribute($0, "AXTitle") as? String == "Log in"
            }
            let cancel = nodes.filter {
                attribute($0, "AXRole") as? String == "AXButton"
                    && attribute($0, "AXTitle") as? String == "Cancel"
            }
            if buttons.count == 1, cancel.count == 1, let button = buttons.first {
                return attribute(button, "AXEnabled") as? Bool == true
            }
            let value = attribute(parent, "AXParent")
            guard let next = try descendants(window).first(where: { sameElement(value, $0) })
            else { throw GuardFailure.form }
            parent = next
        }
        throw GuardFailure.form
    }

    func length(_ placeholder: String, secure: Bool) throws -> Int {
        let target = try field(placeholder, secure: secure)
        guard let value = attribute(target, "AXValue") as? String else { throw GuardFailure.form }
        return value.utf16.count
    }

    func enter(_ placeholder: String, value: String, secure: Bool) throws {
        try requireForeground()
        let target = try field(placeholder, secure: secure)
        inputPhase = secure ? "focus-password" : "focus-email"
        try normalFocus(placeholder, secure: secure)
        func focused() throws {
            try requireForeground()
            guard CFEqual(try field(placeholder, secure: secure), target),
                attribute(target, "AXFocused") as? Bool == true,
                sameElement(attribute(root, "AXFocusedUIElement"), target)
            else { throw GuardFailure.focus }
        }
        func pair(_ key: CGKeyCode, flags: CGEventFlags = [], text: [UniChar] = []) throws {
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: true),
                let up = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: false)
            else { throw GuardFailure.delivery }
            down.flags = flags
            up.flags = flags
            if !text.isEmpty {
                text.withUnsafeBufferPointer { characters in
                    down.keyboardSetUnicodeString(
                        stringLength: characters.count, unicodeString: characters.baseAddress)
                    up.keyboardSetUnicodeString(
                        stringLength: characters.count, unicodeString: characters.baseAddress)
                }
            }
            try focused()
            down.postToPid(pid)
            up.postToPid(pid)
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
            try focused()
        }
        try waitForFocus(target)
        inputPhase = secure ? "deliver-password" : "deliver-email"
        try pair(0, flags: .maskCommand)
        try pair(51)
        for scalar in value.unicodeScalars {
            try pair(0, text: Array(String(scalar).utf16))
        }
        let deadline = Date().addingTimeInterval(2)
        repeat {
            try focused()
            if try length(placeholder, secure: secure) == value.utf16.count { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.03))
        } while Date() < deadline
        throw GuardFailure.delivery
    }

    private func waitForFocus(_ target: AXUIElement) throws {
        let deadline = Date().addingTimeInterval(2)
        while attribute(target, "AXFocused") as? Bool != true
            || !sameElement(attribute(root, "AXFocusedUIElement"), target)
        {
            try requireForeground()
            guard Date() < deadline else { throw GuardFailure.focus }
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
    }

    private func normalFocus(_ placeholder: String, secure: Bool) throws {
        func quoted(_ text: String) throws -> String {
            let bytes = try JSONSerialization.data(
                withJSONObject: text, options: [.fragmentsAllowed])
            guard let encoded = String(bytes: bytes, encoding: .utf8) else {
                throw GuardFailure.input
            }
            return encoded
        }
        let literal = try quoted(placeholder)
        let referenceLiteral = try quoted(referenceDirectory)
        let bindingLiteral = try quoted(formBinding)
        let code =
            "(()=>{if(app.vault.adapter.getBasePath()!==" + referenceLiteral
            + ")throw Error('vault');const d=app.setting.modalEl.ownerDocument;"
            + "const m=Array.from(d.querySelectorAll('.modal.mod-form'))"
            + ".filter(e=>e.querySelector('.modal-title')?.textContent==='Log in to Obsidian');"
            + "if(m.length!==1)throw Error('form');const f=Array.from(m[0].querySelectorAll('input'))"
            + ".filter(e=>e.placeholder==="
            + literal + ");"
            + "if(f.length!==1||f[0].disabled||f[0].type!=='" + (secure ? "password" : "email")
            + "')throw Error('field');m[0].setAttribute('data-facet-official-input',"
            + bindingLiteral + ");f[0].focus();return true})()"
        let child = Process()
        child.executableURL = URL(fileURLWithPath: executable).deletingLastPathComponent()
            .appendingPathComponent("obsidian-cli")
        child.arguments = ["eval", "code=" + code]
        child.currentDirectoryURL = URL(fileURLWithPath: referenceDirectory)
        child.standardInput = FileHandle.nullDevice
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        try child.run()
        let deadline = Date().addingTimeInterval(5)
        while child.isRunning && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
        if child.isRunning {
            child.terminate()
            let exitDeadline = Date().addingTimeInterval(1)
            while child.isRunning && Date() < exitDeadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.02))
            }
            if child.isRunning { kill(child.processIdentifier, SIGKILL) }
            child.waitUntilExit()
            throw GuardFailure.focus
        }
        child.waitUntilExit()
        guard child.terminationStatus == 0 else { throw GuardFailure.focus }
    }
}
