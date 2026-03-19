import Foundation

func glanceLog(_ message: String) {
    let timestamp = ISO8601DateFormatter().string(from: .now)
    let line = "[\(timestamp)] \(message)\n"
    let logPath = "/tmp/glance.log"
    if let handle = FileHandle(forWritingAtPath: logPath) {
        handle.seekToEndOfFile()
        handle.write(Data(line.utf8))
        handle.closeFile()
    } else {
        FileManager.default.createFile(atPath: logPath, contents: Data(line.utf8))
    }
}
