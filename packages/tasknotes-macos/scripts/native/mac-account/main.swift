import AppKit
import ApplicationServices
import Darwin
import Foundation

do {
    guard CommandLine.arguments.count == 1, AXIsProcessTrusted() else { throw Failure.input }
    let stream = try MacInputStream()
    let input = try stream.next(allowEOF: true)
    if input["mode"] as? String == "private_session" {
        var session: MacAccountSession?
        do {
            let prepared = try MacAccountSession(input, stream: stream)
            session = prepared
            try prepared.run()
            exit(0)
        } catch {
            let reason: String
            if let failure = error as? MacInputFailure {
                reason = failure.rawValue
            } else if let failure = error as? Failure {
                reason = String(describing: failure)
            } else {
                reason = "input"
            }
            let knownOperation = input["operation"] as? String ?? "invalid"
            let operation =
                ["credentials-probe", "verification-probe", "credentials", "verification", "vault"]
                    .contains(knownOperation)
                ? knownOperation : "invalid"
            emit([
                "schemaVersion": 1, "kind": "rejected",
                "sessionID": (input["sessionID"] as? String).flatMap(UUID.init(uuidString:))?
                    .uuidString.lowercased() as Any? ?? NSNull(),
                "runID": (input["runID"] as? String).flatMap(UUID.init(uuidString:))?.uuidString
                    .lowercased() as Any? ?? NSNull(),
                "operation": operation, "phase": session?.request.phase ?? "input",
                "reason": reason,
                "intentRecorded": session?.intentRecorded ?? false,
                "submitActionCount": submitCount,
            ])
            exit(3)
        }
    }
    guard
        let mode = input["mode"] as? String,
        let pid = input["pid"] as? Int, pid > 0, pid <= Int(Int32.max),
        [
            "inspect_onboarding", "present_account", "inspect_credentials", "activate_credentials",
            "inspect_verification", "activate_verification", "inspect_vault", "activate_vault",
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
        : ["inspect_verification", "activate_verification"].contains(mode)
            ? "verification" : "vaults"
    var keys: Set<String> = bindingKeys.union(["pid", "mode"])
    if !inspect { keys.formUnion(["startSeconds", "startMicroseconds", "launchDate"]) }
    guard Set(input.keys) == keys else { throw Failure.input }
    let requestID = (input["requestID"] as? String).flatMap(UUID.init(uuidString:))
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
