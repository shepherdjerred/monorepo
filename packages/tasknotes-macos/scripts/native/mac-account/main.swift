import AppKit
import ApplicationServices
import Darwin
import Foundation

do {
    guard CommandLine.arguments.count == 1, AXIsProcessTrusted(),
        let data = try FileHandle.standardInput.read(upToCount: 8193), data.count <= 8192,
        let input = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        let mode = input["mode"] as? String,
        let pid = input["pid"] as? Int, pid > 0, pid <= Int(Int32.max),
        [
            "inspect_onboarding", "present_account", "inspect_credentials", "activate_credentials",
            "fill_credentials", "submit_credentials", "inspect_verification",
            "activate_verification", "verify", "inspect_vault", "activate_vault", "connect",
            "inspect_workspace", "present_lifecycle_account",
        ].contains(mode)
    else { throw Failure.input }
    try bind(input)
    let inspect = mode.hasPrefix("inspect_")
    let activating = mode.hasPrefix("activate_")
    let onboarding = ["inspect_onboarding", "present_account"].contains(mode)
    let workspace = ["inspect_workspace", "present_lifecycle_account"].contains(mode)
    let stage =
        mode.contains("credentials") || onboarding || workspace
        ? "credentials"
        : ["verify", "inspect_verification", "activate_verification"].contains(mode)
            ? "verification" : "vaults"
    var keys: Set<String> = bindingKeys.union(["pid", "mode"])
    if !inspect { keys.formUnion(["startSeconds", "startMicroseconds", "launchDate"]) }
    if mode == "fill_credentials" { keys.formUnion(["email", "password"]) }
    if mode == "verify" { keys.formUnion(["code", "requestID"]) }
    if mode == "connect" { keys.formUnion(["vaultPassword", "requestID"]) }
    guard Set(input.keys) == keys else { throw Failure.input }
    let requestID = (input["requestID"] as? String).flatMap(UUID.init(uuidString:))
    if ["verify", "connect"].contains(mode), requestID == nil { throw Failure.input }
    let owner = try Owner(
        pid: pid_t(pid), stage: stage,
        mutating: !inspect && !activating && !onboarding && !workspace,
        expectedRequestID: requestID,
        anchor: workspace ? "facet.settings.open" : onboarding ? "facet.onboarding.sync" : nil)
    if !inspect {
        guard (input["startSeconds"] as? NSNumber)?.uint64Value == owner.seconds,
            (input["startMicroseconds"] as? NSNumber)?.uint64Value == owner.microseconds,
            (input["launchDate"] as? NSNumber)?.doubleValue == owner.launch
        else { throw Failure.process }
    }
    func secret(_ key: String, maximum: Int) throws -> String {
        guard let value = input[key] as? String, !value.isEmpty, value.utf8.count <= maximum,
            !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { throw Failure.input }
        return value
    }
    let vaultButton =
        lifecycle.map { "facet.account.reconnect." + $0.profileID } ?? "facet.account.vault."
        + remoteID
    let button = stage == "vaults" ? vaultButton : "facet.account.signin"
    if mode == "present_lifecycle_account" {
        try owner.presentLifecycleAccount()
    } else if activating || mode == "present_account" {
        _ = try owner.validate()
        guard let app = NSRunningApplication(processIdentifier: owner.pid) else {
            throw Failure.process
        }
        _ = app.activate(options: [])
        _ = AXUIElementPerformAction(owner.window, kAXRaiseAction as CFString)
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        _ = try owner.validate()
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == owner.pid,
            try owner.focusedWindowIsOwned()
        else { throw Failure.window }
        if mode == "present_account" {
            let navigationButton = try owner.element("facet.onboarding.sync", role: "AXButton")
            guard attr(navigationButton, "AXEnabled") as? Bool == true else { throw Failure.field }
            _ = try owner.validate()
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == owner.pid,
                try owner.focusedWindowIsOwned()
            else { throw Failure.window }
            let outcome = AXUIElementPerformAction(navigationButton, kAXPressAction as CFString)
            emit([
                "runID": runID, "normalNavigationPressCount": 1,
                "normalAXPressResult": outcome.rawValue, "submitActionCount": 0,
            ])
            guard outcome == .success else { throw Failure.action }
        } else {
            emit([
                "runID": runID, "ownedAppActivated": true, "stage": stage, "submitActionCount": 0,
            ])
        }
    } else if mode == "inspect_onboarding" || mode == "inspect_workspace" {
        let onboardingButton = try owner.element(
            workspace ? "facet.settings.open" : "facet.onboarding.sync",
            role: workspace ? "AXMenuButton" : "AXButton",
            alternateRoles: workspace ? ["AXButton", "AXPopUpButton"] : [])
        guard attr(onboardingButton, "AXEnabled") as? Bool == true else { throw Failure.field }
        emit([
            "runID": runID, "pid": pid, "startSeconds": owner.seconds,
            "startMicroseconds": owner.microseconds, "launchDate": owner.launch, "ready": true,
            "stage": stage, "readOnly": true,
        ])
    } else if inspect {
        let field =
            stage == "credentials"
            ? "facet.account.email"
            : stage == "verification" ? "facet.account.code" : "facet.account.vault-password"
        let target = try owner.element(field, role: "AXTextField", secure: stage == "vaults")
        var settable = DarwinBoolean(false)
        guard attr(target, "AXEnabled") as? Bool == true,
            AXUIElementIsAttributeSettable(target, "AXValue" as CFString, &settable) == .success,
            settable.boolValue
        else { throw Failure.setter }
        _ = try owner.element(button, role: "AXButton")
        if stage == "credentials" {
            let password = try owner.element(
                "facet.account.password", role: "AXTextField", secure: true)
            var passwordSettable = DarwinBoolean(false)
            guard attr(password, "AXEnabled") as? Bool == true,
                AXUIElementIsAttributeSettable(password, "AXValue" as CFString, &passwordSettable)
                    == .success,
                passwordSettable.boolValue
            else { throw Failure.setter }
        }
        let status = try owner.validate()
        var result: [String: Any] = [
            "runID": runID, "pid": pid, "startSeconds": owner.seconds,
            "startMicroseconds": owner.microseconds, "launchDate": owner.launch, "ready": true,
            "stage": stage, "readOnly": true,
        ]
        if let exchange = status["accountExchange"] as? [String: Any],
            let request = exchange["requestID"] as? String
        {
            result["requestID"] = request
        }
        emit(result)
    } else if mode == "fill_credentials" {
        let email = try secret("email", maximum: 256)
        let password = try secret("password", maximum: 512)
        try owner.set("facet.account.email", value: "")
        try owner.wait(button, enabled: false)
        try owner.set("facet.account.email", value: email)
        try owner.set("facet.account.password", value: "", secure: true)
        try owner.wait(button, enabled: false)
        try owner.set("facet.account.password", value: password, secure: true)
        try owner.wait(button, enabled: true)
        emit([
            "runID": runID, "credentialsEntered": true, "clearDisabledCheckpointCount": 2,
            "signInEnabled": true, "submitActionCount": 0,
        ])
    } else if mode == "submit_credentials" {
        try owner.press(button)
    } else if mode == "verify" {
        let code = try secret("code", maximum: 6)
        guard code.utf8.count == 6, code.utf8.allSatisfy({ (48...57).contains($0) }) else {
            throw Failure.input
        }
        try owner.set("facet.account.code", value: code)
        try owner.press(button)
    } else {
        let password = try secret("vaultPassword", maximum: 512)
        try owner.set("facet.account.vault-password", value: "", secure: true)
        try owner.wait(button, enabled: false)
        try owner.set("facet.account.vault-password", value: password, secure: true)
        try owner.wait(button, enabled: true)
        try owner.press(button)
    }
} catch let failure as Failure {
    let labels: [Failure: String] = [
        .input: "input", .process: "process", .run: "run", .window: "window", .field: "field",
        .setter: "setter", .action: "action", .session: "session",
    ]
    emit([
        "blocked": labels[failure] ?? "internal", "phase": phase, "submitActionCount": submitCount,
    ])
    exit(3)
} catch {
    emit(["blocked": "internal", "phase": phase, "submitActionCount": submitCount])
    exit(3)
}
