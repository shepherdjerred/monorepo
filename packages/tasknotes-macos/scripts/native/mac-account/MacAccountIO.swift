import Darwin
import Foundation

/// A bounded, non-TTY private stream. No frame bytes are ever persisted.
final class MacInputStream {
    let deadline: Date
    private var pending = Data()

    init() throws {
        deadline = Date().addingTimeInterval(120)
        guard isatty(STDIN_FILENO) == 0, isatty(STDOUT_FILENO) == 0 else {
            throw MacInputFailure.input
        }
        var input = stat()
        var output = stat()
        guard fstat(STDIN_FILENO, &input) == 0, fstat(STDOUT_FILENO, &output) == 0,
            input.st_mode & S_IFMT == S_IFIFO, output.st_mode & S_IFMT == S_IFIFO
        else { throw MacInputFailure.input }
    }

    func live() throws {
        guard Date() < deadline else { throw MacInputFailure.deadline }
    }

    func next(allowEOF: Bool = false) throws -> [String: Any] {
        defer {
            pending.resetBytes(in: 0..<pending.count)
            pending.removeAll()
        }
        while true {
            try live()
            if let end = pending.firstIndex(of: 10) {
                guard end == pending.count - 1 else { throw MacInputFailure.input }
                return try decode(Data(pending[..<end]))
            }
            guard pending.count <= 8192 else { throw MacInputFailure.input }
            var descriptor = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN | POLLHUP), revents: 0)
            let remaining = max(1, min(1000, Int32(deadline.timeIntervalSinceNow * 1000)))
            let result = poll(&descriptor, 1, remaining)
            if result < 0 {
                if errno == EINTR { continue }
                throw MacInputFailure.input
            }
            if result == 0 { continue }
            try requireReadable(descriptor)
            var bytes = [UInt8](repeating: 0, count: min(4096, 8193 - pending.count))
            let count = read(STDIN_FILENO, &bytes, bytes.count)
            defer {
                _ = bytes.withUnsafeMutableBytes {
                    $0.initializeMemory(as: UInt8.self, repeating: 0)
                }
            }
            guard count >= 0 else { throw MacInputFailure.input }
            if count == 0 {
                guard allowEOF, !pending.isEmpty else { throw MacInputFailure.input }
                return try decode(pending)
            }
            pending.append(contentsOf: bytes.prefix(count))
        }
    }

    private func requireReadable(_ descriptor: pollfd) throws {
        guard descriptor.revents & Int16(POLLERR | POLLNVAL) == 0 else {
            throw MacInputFailure.input
        }
    }

    private func decode(_ bytes: Data) throws -> [String: Any] {
        guard !bytes.isEmpty, bytes.count <= 8192,
            let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
        else { throw MacInputFailure.input }
        return object
    }
}
