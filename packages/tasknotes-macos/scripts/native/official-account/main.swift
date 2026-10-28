import AppKit
import ApplicationServices
import CryptoKit
import Darwin
import Foundation

func validateBinding(_ input: [String: Any]) throws {
    var virtualized: Int32 = 0
    var length = MemoryLayout<Int32>.size
    guard sysctlbyname("kern.hv_vmm_present", &virtualized, &length, nil, 0) == 0,
        virtualized == 1, let purpose = input["purpose"] as? String,
        let run = input["runID"] as? String, UUID(uuidString: run)?.uuidString.lowercased() == run,
        let reference = input["referenceDirectory"] as? String,
        URL(fileURLWithPath: reference).resolvingSymlinksInPath().path == reference
    else { throw GuardFailure.binding }
    if purpose == "probe" {
        guard ["inspect", "probe"].contains(input["mode"] as? String ?? ""),
            reference == FileManager.default.homeDirectoryForCurrentUser.path
                + "/Library/Application Support/FacetAcceptanceHarness/Observations/" + run
                + "/reference-vault"
        else { throw GuardFailure.binding }
        return
    }
    guard purpose == "live", let configFile = input["configFile"] as? String,
        let expected = input["configSHA256"] as? String,
        let build = UUID(
            uuidString: URL(fileURLWithPath: configFile).deletingLastPathComponent()
                .lastPathComponent),
        configFile == "/Volumes/My Shared Files/exports/" + build.uuidString.lowercased()
            + "/live-config.json",
        SHA256.hash(data: try Data(contentsOf: URL(fileURLWithPath: configFile)))
            .map({ String(format: "%02x", $0) }).joined() == expected,
        let config = try JSONSerialization.jsonObject(
            with: Data(contentsOf: URL(fileURLWithPath: configFile))) as? [String: Any],
        config["runID"] as? String == run,
        (config["officialApp"] as? [String: Any])?["exportID"] as? String
            == input["officialExportID"] as? String,
        let packageRoot = config["packageRoot"] as? String
    else { throw GuardFailure.binding }
    let runDirectory =
        URL(fileURLWithPath: packageRoot).deletingLastPathComponent().path
        + "/tasks-for-obsidian/.build/live-sync/" + run
    let checkpoint = try ownedJSON(runDirectory + "/account-checkpoint.json")
    guard reference == runDirectory + "/reference-vault",
        checkpoint["guestConfigSHA256"] as? String == expected,
        let binding = checkpoint["binding"] as? [String: Any], binding["runID"] as? String == run,
        let state = checkpoint["checkpoint"] as? [String: Any],
        state["stage"] as? String == "owner-setup", state["failuresCount"] as? Int == 0
    else { throw GuardFailure.binding }
}

do {
    guard CommandLine.arguments.count == 1, AXIsProcessTrusted()
    else { throw GuardFailure.input }
    let input = try readOfficialFrame()
    guard let mode = input["mode"] as? String else { throw GuardFailure.input }
    if mode == "verification-prepare" {
        try prepareOfficialVerification(input)
        exit(0)
    }
    if mode == "verification-session" {
        try runOfficialVerificationSession(input)
        exit(0)
    }
    guard ["inspect", "fill", "clear", "probe"].contains(mode) else { throw GuardFailure.input }
    var keys: Set<String> = [
        "purpose", "mode", "runID", "referenceDirectory", "officialExportID", "executable", "pid",
    ]
    if input["purpose"] as? String == "live" { keys.formUnion(["configFile", "configSHA256"]) }
    if mode != "inspect" { keys.formUnion(["startSeconds", "startMicroseconds", "launchDate"]) }
    if mode == "fill" { keys.formUnion(["email", "password"]) }
    guard Set(input.keys) == keys else { throw GuardFailure.input }
    try validateBinding(input)
    inputPhase = "owner"
    let owner = try OfficialOwner(input)
    var result: [String: Any] = [
        "ready": true, "pid": owner.pid, "startSeconds": owner.seconds,
        "startMicroseconds": owner.microseconds, "launchDate": owner.launchDate,
        "secureField": true, "submitActionCount": 0,
        "formBinding": owner.formBinding,
    ]
    _ = try owner.field("Your email...", secure: false)
    _ = try owner.field("Your password...", secure: true)
    guard try owner.loginEnabled() else { throw GuardFailure.form }
    if mode != "inspect" {
        guard (input["startSeconds"] as? NSNumber)?.uint64Value == owner.seconds,
            (input["startMicroseconds"] as? NSNumber)?.uint64Value == owner.microseconds,
            (input["launchDate"] as? NSNumber)?.doubleValue == owner.launchDate
        else { throw GuardFailure.process }
        inputPhase = "activate"
        try owner.activate()
        var email = ""
        var password = ""
        if mode == "probe" {
            email = "facet-acceptance@example.invalid"
            password = "Facet acceptance public sentinel 2026!"
        } else if mode == "fill" {
            guard let suppliedEmail = input["email"] as? String, !suppliedEmail.isEmpty,
                let suppliedPassword = input["password"] as? String, !suppliedPassword.isEmpty,
                suppliedEmail.utf8.count <= 256, suppliedPassword.utf8.count <= 512,
                !(suppliedEmail + suppliedPassword).unicodeScalars.contains(
                    where: CharacterSet.controlCharacters.contains)
            else { throw GuardFailure.input }
            email = suppliedEmail
            password = suppliedPassword
        }
        try owner.enter("Your email...", value: "", secure: false)
        try owner.enter("Your password...", value: "", secure: true)
        guard try owner.length("Your email...", secure: false) == 0,
            try owner.length("Your password...", secure: true) == 0,
            try owner.loginEnabled()
        else { throw GuardFailure.delivery }
        try owner.enter("Your email...", value: email, secure: false)
        try owner.enter("Your password...", value: password, secure: true)
        result["emailLength"] = try owner.length("Your email...", secure: false)
        result["passwordLength"] = try owner.length("Your password...", secure: true)
        result["focusedSecureField"] = true
        if mode == "probe" {
            try owner.enter("Your email...", value: "", secure: false)
            try owner.enter("Your password...", value: "", secure: true)
            guard try owner.length("Your email...", secure: false) == 0,
                try owner.length("Your password...", secure: true) == 0
            else { throw GuardFailure.delivery }
            result["cleared"] = true
        }
    }
    result["loginEnabled"] = try owner.loginEnabled()
    if mode == "inspect" {
        result["emailLength"] = try owner.length("Your email...", secure: false)
        result["passwordLength"] = try owner.length("Your password...", secure: true)
    }
    let output = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(output)
} catch let failure as GuardFailure {
    let output = "{\"blocked\":\"\(failure)\",\"phase\":\"\(inputPhase)\",\"submitActionCount\":0}"
    FileHandle.standardOutput.write(Data(output.utf8))
    exit(3)
} catch {
    let output = "{\"blocked\":\"internal\",\"phase\":\"\(inputPhase)\",\"submitActionCount\":0}"
    FileHandle.standardOutput.write(Data(output.utf8))
    exit(3)
}
