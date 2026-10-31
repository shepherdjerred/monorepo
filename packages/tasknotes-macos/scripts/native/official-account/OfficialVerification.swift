import AppKit
import CryptoKit
import Darwin
import Foundation

struct OfficialVerificationProtocol {
    let definition: [String: Any]
    let config: [String: Any]

    init(_ input: [String: Any]) throws {
        guard let file = input["configFile"] as? String,
            let expected = input["configSHA256"] as? String
        else { throw GuardFailure.input }
        let bytes = try Data(contentsOf: URL(fileURLWithPath: file))
        guard Self.sha(bytes) == expected,
            let parsedConfig = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
            let hashes = parsedConfig["helpers"] as? [String: String]
        else { throw GuardFailure.binding }
        let protocolFile = URL(fileURLWithPath: file).deletingLastPathComponent()
            .appendingPathComponent("live-helpers/official-verification.protocol.json")
        let protocolBytes = try Data(contentsOf: protocolFile)
        guard Self.sha(protocolBytes) == hashes["official-verification.protocol.json"],
            let parsedDefinition = try JSONSerialization.jsonObject(with: protocolBytes)
                as? [String: Any],
            parsedDefinition["schemaVersion"] as? Int == 1
        else { throw GuardFailure.binding }
        self.definition = parsedDefinition
        self.config = parsedConfig
    }

    static func sha(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    func methodPolicy() throws -> String {
        guard let policy = definition["methodWords"] as? [String: String],
            Set(policy.keys) == ["allowedPattern", "forbiddenPattern"],
            let result = String(
                data: try JSONSerialization.data(withJSONObject: policy, options: [.sortedKeys]),
                encoding: .utf8)
        else { throw GuardFailure.binding }
        return result
    }

    func verifyOfficialAsar(_ program: String) throws {
        let file = URL(fileURLWithPath: program).deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Resources/obsidian.asar")
        guard let expected = definition["officialAsarSHA256"] as? String,
            Self.sha(try Data(contentsOf: file)) == expected
        else { throw GuardFailure.binding }
    }

    func limit(_ name: String) throws -> Double {
        guard let limits = definition["limits"] as? [String: NSNumber], let value = limits[name],
            value.doubleValue > 0
        else { throw GuardFailure.binding }
        return value.doubleValue
    }

    func validate(_ object: [String: Any], frame: String) throws {
        guard let frames = definition["frames"] as? [String: [String]], let names = frames[frame],
            Set(names) == Set(object.keys),
            let rules = definition["fields"] as? [String: [String: Any]],
            ["init", "prepare"].contains(frame) || object["kind"] as? String == frame
        else { throw GuardFailure.input }
        if let modes = definition["frameModes"] as? [String: String], let expected = modes[frame],
            object["mode"] as? String != expected
        {
            throw GuardFailure.input
        }
        for name in names {
            guard let value = object[name], let rule = rules[name],
                let type = rule["type"] as? String
            else { throw GuardFailure.binding }
            try validateValue(value, rule: rule, type: type)
        }
    }

    private func validateValue(_ value: Any, rule: [String: Any], type: String) throws {
        if type == "string" {
            try validateString(value, rule: rule)
        } else {
            try validateNumber(value, rule: rule, type: type)
        }
        if let values = rule["enum"] as? [NSObject], let candidate = value as? NSObject,
            !values.contains(where: { $0 == candidate })
        {
            throw GuardFailure.input
        }
    }

    private func validateString(_ value: Any, rule: [String: Any]) throws {
        guard let text = value as? String else { throw GuardFailure.input }
        if let minimum = rule["minLength"] as? Int, text.utf16.count < minimum {
            throw GuardFailure.input
        }
        if let maximum = rule["maxLength"] as? Int, text.utf16.count > maximum {
            throw GuardFailure.input
        }
        if let pattern = rule["pattern"] as? String,
            text.range(of: pattern, options: .regularExpression) != text.startIndex..<text.endIndex
        {
            throw GuardFailure.input
        }
    }

    private func validateNumber(_ value: Any, rule: [String: Any], type: String) throws {
        guard let number = value as? NSNumber else { throw GuardFailure.input }
        let boolean = CFGetTypeID(number) == CFBooleanGetTypeID()
        guard boolean == (type == "boolean"), ["boolean", "integer", "number"].contains(type) else {
            throw GuardFailure.input
        }
        if type == "boolean" { return }
        guard number.doubleValue.isFinite else { throw GuardFailure.input }
        if type == "integer", number.doubleValue.rounded() != number.doubleValue {
            throw GuardFailure.input
        }
        if let minimum = rule["minimum"] as? Double, number.doubleValue < minimum {
            throw GuardFailure.input
        }
        if let maximum = rule["maximum"] as? Double, number.doubleValue > maximum {
            throw GuardFailure.input
        }
    }

    func write(_ object: [String: Any], frame: String) throws {
        try validate(object, frame: frame)
        var bytes = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        bytes.append(10)
        guard Double(bytes.count) <= (try limit("frameBytes")) else { throw GuardFailure.input }
        try FileHandle.standardOutput.write(contentsOf: bytes)
    }
}

func readOfficialFrame() throws -> [String: Any] {
    var bytes = Data()
    while let block = try FileHandle.standardInput.read(upToCount: 1), !block.isEmpty {
        if block[0] == 10 { break }
        bytes.append(block)
        guard bytes.count <= 8192 else { throw GuardFailure.input }
    }
    guard !bytes.isEmpty,
        let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
    else { throw GuardFailure.input }
    return object
}

private func retainVerificationRecord(
    _ value: [String: Any], name: String, input: [String: Any], config: [String: Any]
) throws {
    guard let package = config["packageRoot"] as? String, let run = input["runID"] as? String else {
        throw GuardFailure.binding
    }
    let parent = URL(fileURLWithPath: package).deletingLastPathComponent()
        .appendingPathComponent("tasks-for-obsidian/.build/live-sync/" + run + "/official-account")
    guard
        [
            "verification-submission-attempt.json", "verification-probe-ready.json",
            "verification-probe-attempt.json",
        ].contains(name)
    else { throw GuardFailure.input }
    let file = parent.appendingPathComponent(name).path
    let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    let descriptor = open(file, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { throw GuardFailure.binding }
    defer { close(descriptor) }
    var offset = 0
    try bytes.withUnsafeBytes { buffer in
        guard let base = buffer.baseAddress else { throw GuardFailure.input }
        while offset < bytes.count {
            let count = Darwin.write(descriptor, base.advanced(by: offset), bytes.count - offset)
            guard count > 0 else { throw GuardFailure.binding }
            offset += count
        }
    }
    guard fsync(descriptor) == 0 else { throw GuardFailure.binding }
}

func prepareOfficialVerification(_ input: [String: Any]) throws {
    inputPhase = "verification-protocol"
    let protocolDefinition = try OfficialVerificationProtocol(input)
    try protocolDefinition.validate(input, frame: "prepare")
    inputPhase = "verification-binding"
    try validateBinding(input)
    var inspect = input
    inspect["mode"] = "inspect"
    inputPhase = "verification-owner"
    let owner = try OfficialOwner(inspect, formKind: .totp)
    inputPhase = "verification-archive"
    try protocolDefinition.verifyOfficialAsar(owner.executable)
    guard let challenge = input["challengeID"] as? String,
        let session = input["sessionID"] as? String,
        let run = input["runID"] as? String
    else { throw GuardFailure.input }
    inputPhase = "verification-form"
    try owner.verificationDOM(
        input["operation"] as? String == "probe" ? .bind : .inspect, challenge: challenge)
    inputPhase = "verification-ready"
    try protocolDefinition.write(
        [
            "kind": "ready", "sessionID": session, "runID": run,
            "challengeID": challenge, "pid": owner.pid, "startSeconds": owner.seconds,
            "startMicroseconds": owner.microseconds, "launchDate": owner.launchDate,
            "clockEpochMs": Int64(Date().timeIntervalSince1970 * 1000), "formKind": "totp",
            "codeFieldSecure": false, "loginEnabled": true,
        ], frame: "ready")
}

private func requireVerificationProbe(
    _ input: [String: Any], protocolDefinition: OfficialVerificationProtocol
) throws {
    guard input["operation"] as? String == "verify" else { return }
    guard let package = protocolDefinition.config["packageRoot"] as? String,
        let run = input["runID"] as? String
    else { throw GuardFailure.binding }
    let file = URL(fileURLWithPath: package).deletingLastPathComponent().appendingPathComponent(
        "tasks-for-obsidian/.build/live-sync/" + run
            + "/official-account/verification-probe-ready.json"
    ).path
    let proof = try ownedJSON(file)
    try protocolDefinition.validate(proof, frame: "proof")
    for name in [
        "runID", "configSHA256", "binarySHA256", "challengeID", "pid", "startSeconds",
        "startMicroseconds", "launchDate",
    ] {
        guard let expected = input[name] as? NSObject, let actual = proof[name] as? NSObject,
            actual == expected
        else { throw GuardFailure.binding }
    }
    guard proof["cleared"] as? Bool == true, proof["submitActionCount"] as? Int == 0 else {
        throw GuardFailure.binding
    }
}

private func verificationCode(
    _ input: [String: Any], request: [String: Any], protocolDefinition: OfficialVerificationProtocol
) throws -> String {
    if input["operation"] as? String == "probe" {
        guard let fake = protocolDefinition.definition["probeCode"] as? String else {
            throw GuardFailure.binding
        }
        let attempt = input.filter { ["runID", "sessionID", "challengeID"].contains($0.key) }
        try retainVerificationRecord(
            attempt, name: "verification-probe-attempt.json", input: input,
            config: protocolDefinition.config)
        return fake
    }
    let now = Date().timeIntervalSince1970 * 1000
    guard let issued = request["issuedAtEpochMs"] as? Double,
        let expiry = request["validUntilEpochMs"] as? Double,
        abs(now - issued) <= (try protocolDefinition.limit("clockSkewMs")),
        expiry - now >= (try protocolDefinition.limit("deliveryMs")),
        let supplied = request["code"] as? String
    else { throw GuardFailure.input }
    var intent = input
    intent.removeValue(forKey: "operation")
    intent["kind"] = "official-verification-submit-attempt"
    try retainVerificationRecord(
        intent, name: "verification-submission-attempt.json", input: input,
        config: protocolDefinition.config)
    return supplied
}

func runOfficialVerificationSession(_ input: [String: Any]) throws {
    let protocolDefinition = try OfficialVerificationProtocol(input)
    try protocolDefinition.validate(input, frame: "init")
    try validateBinding(input)
    guard let executable = Bundle.main.executableURL,
        let binaryHash = input["binarySHA256"] as? String,
        OfficialVerificationProtocol.sha(try Data(contentsOf: executable)) == binaryHash,
        let session = input["sessionID"] as? String, let run = input["runID"] as? String,
        let challenge = input["challengeID"] as? String,
        let operation = input["operation"] as? String
    else { throw GuardFailure.binding }
    try requireVerificationProbe(input, protocolDefinition: protocolDefinition)
    alarm(UInt32(try protocolDefinition.limit("sessionMs") / 1000))
    let owner = try OfficialOwner(input, formKind: .totp)
    try protocolDefinition.verifyOfficialAsar(owner.executable)
    try owner.verificationDOM(operation == "probe" ? .bind : .inspect, challenge: challenge)
    try owner.activate()
    try owner.enter("", value: "", secure: false)
    guard try owner.length("", secure: false) == 0 else { throw GuardFailure.delivery }
    let readyField = try owner.field("", secure: false)
    let common: [String: Any] = ["sessionID": session, "runID": run, "challengeID": challenge]
    var ready = common
    ready.merge([
        "kind": "ready", "pid": owner.pid, "startSeconds": owner.seconds,
        "startMicroseconds": owner.microseconds, "launchDate": owner.launchDate,
        "clockEpochMs": Int64(Date().timeIntervalSince1970 * 1000), "formKind": "totp",
        "codeFieldSecure": false, "loginEnabled": true,
    ]) { _, new in new }
    try protocolDefinition.write(ready, frame: "ready")
    let request = try readOfficialFrame()
    let frame = operation == "probe" ? "probe" : "code"
    try protocolDefinition.validate(request, frame: frame)
    guard common.allSatisfy({ (request[$0.key] as? String) == ($0.value as? String) }) else {
        throw GuardFailure.binding
    }
    try owner.requireForeground()
    guard CFEqual(try owner.field("", secure: false), readyField) else { throw GuardFailure.form }
    try finishOfficialVerification(
        input, request: request, owner: owner, protocolDefinition: protocolDefinition)
}

private func finishOfficialVerification(
    _ input: [String: Any], request: [String: Any], owner: OfficialOwner,
    protocolDefinition: OfficialVerificationProtocol
) throws {
    guard let operation = input["operation"] as? String,
        let challenge = input["challengeID"] as? String,
        let session = input["sessionID"] as? String, let run = input["runID"] as? String,
        let configHash = input["configSHA256"] as? String,
        let binaryHash = input["binarySHA256"] as? String
    else { throw GuardFailure.binding }
    let common: [String: Any] = ["sessionID": session, "runID": run, "challengeID": challenge]
    let code = try verificationCode(input, request: request, protocolDefinition: protocolDefinition)
    try owner.enter("", value: code, secure: false, alreadyFocused: true)
    guard try owner.length("", secure: false) == 6 else { throw GuardFailure.delivery }
    if operation == "probe" {
        try owner.enter("", value: "", secure: false)
        guard try owner.length("", secure: false) == 0 else { throw GuardFailure.delivery }
    } else {
        guard let expiry = request["validUntilEpochMs"] as? Double,
            expiry - Date().timeIntervalSince1970 * 1000
                >= (try protocolDefinition.limit("deliveryMs"))
        else { throw GuardFailure.delivery }
        try owner.verificationDOM(.submit, challenge: challenge)
    }
    var finished = common
    finished.merge([
        "kind": "finished", "cleared": operation == "probe", "codeLength": 6,
        "submitActionCount": operation == "probe" ? 0 : 1,
    ]) { _, new in new }
    if operation == "probe" {
        let proof: [String: Any] = [
            "schemaVersion": 1, "kind": "proof", "sessionID": session,
            "runID": run, "configSHA256": configHash,
            "binarySHA256": binaryHash, "challengeID": challenge,
            "pid": owner.pid, "startSeconds": owner.seconds,
            "startMicroseconds": owner.microseconds,
            "launchDate": owner.launchDate, "formKind": "totp", "codeFieldSecure": false,
            "cleared": true, "codeLength": 6, "submitActionCount": 0,
        ]
        try protocolDefinition.validate(proof, frame: "proof")
        try retainVerificationRecord(
            proof, name: "verification-probe-ready.json", input: input,
            config: protocolDefinition.config)
    }
    try protocolDefinition.write(finished, frame: "finished")
}

enum OfficialVerificationDOMAction { case bind, inspect, focus, submit }

private func encodedVerificationString(_ value: String) throws -> String {
    let bytes = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
    guard let result = String(data: bytes, encoding: .utf8) else { throw GuardFailure.input }
    return result
}

extension OfficialOwner {
    func verificationDOM(_ action: OfficialVerificationDOMAction, challenge: String) throws {
        try validate()
        guard let verificationMethodPolicy else { throw GuardFailure.binding }
        let prefix =
            "(()=>{if(app.vault.adapter.getBasePath()!=="
            + (try encodedVerificationString(referenceDirectory))
            + ")throw Error('vault');const d=app.setting.modalEl.ownerDocument;"
            + "const visible=e=>e.getClientRects().length>0&&e.getBoundingClientRect().width>0"
            + "&&e.getBoundingClientRect().height>0;"
            + "const forms=Array.from(d.querySelectorAll('.modal.mod-form')).filter(e=>visible(e)"
            + "&&e.querySelector('.modal-title')?.textContent==='Log in to Obsidian');"
            + "if(forms.length!==1)throw Error('form');const m=forms[0];"
            + "const walker=d.createTreeWalker(m,NodeFilter.SHOW_TEXT);const text=[];let node,n=0;"
            + "while((node=walker.nextNode())&&n++<2000){if(node.parentElement&&visible(node.parentElement))"
            + "text.push(node.textContent??'');}if(n>=2000)throw Error('bound');const words=text.join(' ');"
            + "const policy=" + verificationMethodPolicy + ";"
            + "if(!new RegExp(policy.allowedPattern,'i').test(words)"
            + "||new RegExp(policy.forbiddenPattern,'is').test(words))"
            + "throw Error('method');const f=Array.from(m.querySelectorAll('input')).filter(visible);"
            + "if(f.length!==1||f[0].type!=='text'||f[0].autocomplete!=='one-time-code'"
            + "||f[0].inputMode!=='numeric'||f[0].maxLength!==6||f[0].disabled)throw Error('field');"
            + "const login=Array.from(m.querySelectorAll('button')).filter(e=>visible(e)"
            + "&&e.textContent.trim()==='Log in');"
            + "const cancel=Array.from(m.querySelectorAll('button')).filter(e=>visible(e)"
            + "&&e.textContent.trim()==='Cancel');"
            + "if(login.length!==1||cancel.length!==1||login[0].disabled)throw Error('controls');const id="
            + (try encodedVerificationString(challenge)) + ";const binding="
            + (try encodedVerificationString(formBinding)) + ";"
        let operation: String
        switch action {
        case .bind:
            operation =
                "const prior=d.defaultView.__facetOfficialVerification;"
                + "if(prior&&(prior.node!==m||prior.field!==f[0]||prior.id!==id||prior.binding!==binding))"
                + "throw Error('replaced');d.defaultView.__facetOfficialVerification={node:m,field:f[0],id,binding};"
        case .inspect, .focus, .submit:
            operation =
                "const prior=d.defaultView.__facetOfficialVerification;"
                + "if(!prior||prior.node!==m||prior.field!==f[0]||prior.id!==id||prior.binding!==binding)"
                + "throw Error('replaced');"
        }
        let tail: String
        switch action {
        case .bind, .inspect: tail = "return true})()"
        case .focus: tail = "f[0].focus();return true})()"
        case .submit:
            tail =
                "if(!/^[0-9]{6}$/.test(f[0].value))throw Error('code');login[0].click();return true})()"
        }
        try runDOM(prefix + operation + tail)
    }
}
