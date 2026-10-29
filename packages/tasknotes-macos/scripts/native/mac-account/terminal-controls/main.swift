import Darwin
import Foundation

// Explicit non-UI fixture: admission and terminal EOF compile from the original stream.
do {
    guard CommandLine.arguments.count == 1 else { exit(2) }
    let stream = try MacInputStream()
    let input = try stream.next()
    guard Set(input.keys) == ["mode"], let mode = input["mode"] as? String,
        [
            "eager", "fixed", "nonzero", "diagnostic", "trailing-output", "native-deadline",
            "long-deadline",
        ].contains(mode)
    else { exit(2) }
    if mode == "long-deadline" {
        _ = try MacInputStream(deadline: Date().addingTimeInterval(121))
        exit(4)
    }
    let terminalStream =
        mode == "native-deadline"
        ? try MacInputStream(deadline: Date().addingTimeInterval(0.5)) : stream
    let receipt: [String: Any] = [
        "kind": "finished", "pid": getpid(),
        "deadlineUnixMilliseconds": Int64(terminalStream.deadline.timeIntervalSince1970 * 1000),
    ]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: receipt))
    FileHandle.standardOutput.write(Data([10]))
    if mode != "eager" { try terminalStream.requireEOF() }
    if mode == "nonzero" { exit(23) }
    if mode == "diagnostic" {
        FileHandle.standardError.write(Data("synthetic diagnostic\n".utf8))
    }
    if mode == "trailing-output" {
        FileHandle.standardOutput.write(Data("synthetic trailing output\n".utf8))
    }
    exit(0)
} catch let error as MacInputFailure {
    let receipt = ["kind": "rejected", "reason": error.rawValue]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: receipt))
    FileHandle.standardOutput.write(Data([10]))
    exit(3)
} catch {
    FileHandle.standardOutput.write(Data("{\"kind\":\"rejected\",\"reason\":\"input\"}\n".utf8))
    exit(3)
}
