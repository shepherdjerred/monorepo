import Foundation

// The protocol executable never starts UI or invokes the production session. Any accidental
// attempt to enter its unused UI dependency fails closed rather than accessing a real run.
func validateBinding(_ input: [String: Any]) throws { throw GuardFailure.binding }

do {
    guard CommandLine.arguments.count == 4 else { throw GuardFailure.input }
    let context: [String: Any] = [
        "configFile": CommandLine.arguments[2], "configSHA256": CommandLine.arguments[3],
    ]
    let definition = try OfficialVerificationProtocol(context)
    let frame = try readOfficialFrame()
    try definition.validate(frame, frame: CommandLine.arguments[1])
    FileHandle.standardOutput.write(Data("{\"valid\":true}\n".utf8))
} catch {
    FileHandle.standardOutput.write(Data("{\"valid\":false}\n".utf8))
    exit(3)
}
