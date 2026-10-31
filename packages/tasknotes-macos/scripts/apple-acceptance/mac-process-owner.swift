import CoreFoundation
import Darwin
import Foundation

enum Rejection: String, Error {
    case input, uid, path, lifetime, signal
    case missingProcess = "missing-process"
}
struct Identity: Equatable {
    let uid: UInt64, ruid: UInt64, startSeconds: UInt64, startMicroseconds: UInt64
    var packet: [String: Any] {
        [
            "uid": uid, "ruid": ruid, "startSeconds": startSeconds,
            "startMicroseconds": startMicroseconds,
        ]
    }
}
func integer(_ value: Any?, maximum: UInt64, minimum: UInt64 = 0) throws -> UInt64 {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
        number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
        number.doubleValue >= Double(minimum), number.doubleValue <= Double(maximum)
    else { throw Rejection.input }
    return number.uint64Value
}
func identity(_ input: Any?) throws -> Identity {
    guard let value = input as? [String: Any],
        Set(value.keys) == ["uid", "ruid", "startSeconds", "startMicroseconds"]
    else { throw Rejection.input }
    return try Identity(
        uid: integer(value["uid"], maximum: UInt64(UInt32.max)),
        ruid: integer(value["ruid"], maximum: UInt64(UInt32.max)),
        startSeconds: integer(value["startSeconds"], maximum: 9_007_199_254_740_991, minimum: 1),
        startMicroseconds: integer(value["startMicroseconds"], maximum: 999_999))
}
func inspect(_ pid: pid_t, executable: String) throws -> Identity {
    var info = proc_bsdinfo()
    var buffer = [CChar](repeating: 0, count: 4096)
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
        info.pbi_pid == UInt32(pid)
    else {
        throw Rejection.missingProcess
    }
    guard info.pbi_uid == geteuid(), info.pbi_ruid == getuid() else { throw Rejection.uid }
    guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0,
        String(bytes: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, encoding: .utf8)
            == executable
    else { throw Rejection.path }
    guard info.pbi_start_tvsec > 0, info.pbi_start_tvsec <= 9_007_199_254_740_991,
        info.pbi_start_tvusec < 1_000_000
    else { throw Rejection.lifetime }
    return Identity(
        uid: UInt64(info.pbi_uid), ruid: UInt64(info.pbi_ruid), startSeconds: info.pbi_start_tvsec,
        startMicroseconds: info.pbi_start_tvusec)
}
var operation: String?
var targetPID: pid_t?
func emit(
    outcome: String, identity: Identity? = nil, reason: Rejection? = nil,
    signalSubmitted: Bool = false
) {
    let packet: [String: Any] = [
        "schemaVersion": 1, "operation": operation as Any? ?? NSNull(),
        "pid": targetPID as Any? ?? NSNull(), "outcome": outcome,
        "identity": identity?.packet as Any? ?? NSNull(),
        "reason": reason?.rawValue as Any? ?? NSNull(), "signalSubmitted": signalSubmitted,
    ]
    do {
        let data = try JSONSerialization.data(withJSONObject: packet, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    } catch {
        FileHandle.standardError.write(Data("Process-owner response serialization failed.\n".utf8))
        exit(4)
    }
}
do {
    guard CommandLine.arguments.count == 1,
        let data = try FileHandle.standardInput.read(upToCount: 16_385), data.count <= 16_384,
        let input = try JSONSerialization.jsonObject(with: data) as? [String: Any],
        Set(input.keys) == ["schemaVersion", "operation", "pid", "executable", "expected"],
        try integer(input["schemaVersion"], maximum: 1, minimum: 1) == 1,
        let requestedOperation = input["operation"] as? String,
        ["inspect", "terminate"].contains(requestedOperation),
        let executable = input["executable"] as? String, executable.hasPrefix("/"),
        executable.unicodeScalars.count <= 4096,
        !executable.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
    else { throw Rejection.input }
    let pid = pid_t(try integer(input["pid"], maximum: UInt64(Int32.max), minimum: 1))
    operation = requestedOperation
    targetPID = pid
    let expected: Identity?
    if operation == "inspect" {
        guard input["expected"] is NSNull else { throw Rejection.input }
        expected = nil
    } else {
        expected = try identity(input["expected"])
    }
    let first = try inspect(pid, executable: executable)
    if let expected {
        guard expected.uid == first.uid, expected.ruid == first.ruid else { throw Rejection.uid }
        guard expected == first else { throw Rejection.lifetime }
        // Adjacent lifetime/path checks reduce reuse risk; metadata inspection and signal are not atomic.
        guard try inspect(pid, executable: executable) == first else { throw Rejection.lifetime }
        guard Darwin.kill(pid, SIGTERM) == 0 else { throw Rejection.signal }
        emit(outcome: "signal-submitted", identity: first, signalSubmitted: true)
    } else {
        emit(outcome: "inspected", identity: first)
    }
} catch let reason as Rejection {
    emit(outcome: "rejected", reason: reason)
    exit(3)
} catch {
    emit(outcome: "rejected", reason: .input)
    exit(3)
}
