import Darwin
import Foundation

/// A single owned peer, relative Unix socket, bounded frames and absolute deadline.
final class AccountInputSocket {
    private let directory: URL
    private let socketPath: String
    private let originalDirectory: String
    private let deadline = ProcessInfo.processInfo.systemUptime + 120
    private var listener: Int32 = -1
    private var peer: Int32 = -1
    private var socketIdentity: stat?
    private var pending = Data()

    init(sessionID: String) throws {
        let manager = FileManager.default
        originalDirectory = manager.currentDirectoryPath
        let home = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        let temporary = manager.temporaryDirectory.standardizedFileURL
        guard temporary.path == home.appendingPathComponent("tmp").path,
            temporary.resolvingSymlinksInPath().path == temporary.path
        else { throw AccountInputFailure.ownership }
        let parent = temporary.appendingPathComponent("FacetAccountInput", isDirectory: true)
        directory = parent.appendingPathComponent(sessionID, isDirectory: true)
        let basename = "facet-account-\(sessionID).sock"
        socketPath = directory.appendingPathComponent(basename).path
        try Self.privateDirectory(parent, fresh: false)
        try Self.privateDirectory(directory, fresh: true)
        do {
            guard manager.changeCurrentDirectoryPath(directory.path) else {
                throw AccountInputFailure.ownership
            }
            listener = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
            guard listener >= 0 else { throw AccountInputFailure.socket }
            var address = sockaddr_un()
            address.sun_family = sa_family_t(AF_UNIX)
            let name = Array(basename.utf8) + [0]
            guard name.count <= MemoryLayout.size(ofValue: address.sun_path) else {
                throw AccountInputFailure.socket
            }
            withUnsafeMutableBytes(of: &address.sun_path) { storage in
                storage.copyBytes(from: name)
            }
            address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
            let bound = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            guard bound == 0, chmod(basename, 0o600) == 0 else {
                throw AccountInputFailure.socket
            }
            var metadata = stat()
            guard lstat(basename, &metadata) == 0, metadata.st_uid == getuid(),
                metadata.st_mode & S_IFMT == S_IFSOCK, metadata.st_mode & 0o777 == 0o600
            else { throw AccountInputFailure.ownership }
            socketIdentity = metadata
            guard listen(listener, 1) == 0 else { throw AccountInputFailure.socket }
        } catch {
            close()
            throw AccountInputFailure.socket
        }
    }

    private static func privateDirectory(_ url: URL, fresh: Bool) throws {
        let created = mkdir(url.path, 0o700)
        guard created == 0 || (!fresh && errno == EEXIST) else {
            throw AccountInputFailure.ownership
        }
        var metadata = stat()
        guard lstat(url.path, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFDIR,
            metadata.st_uid == getuid(), metadata.st_mode & 0o777 == 0o700,
            url.resolvingSymlinksInPath().path == url.path
        else { throw AccountInputFailure.ownership }
    }

    func acceptPeer() throws {
        try ready(listener, events: Int16(POLLIN))
        peer = Darwin.accept(listener, nil, nil)
        guard peer >= 0 else { throw AccountInputFailure.socket }
        var user: uid_t = 0
        var group: gid_t = 0
        guard getpeereid(peer, &user, &group) == 0, user == getuid() else {
            throw AccountInputFailure.ownership
        }
        var noSignal: Int32 = 1
        guard
            setsockopt(
                peer, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size)) == 0
        else { throw AccountInputFailure.socket }
    }

    func receive() throws -> Data {
        while true {
            if let newline = pending.firstIndex(of: 10) {
                guard newline > 0, newline <= 8192 else { throw AccountInputFailure.input }
                let frame = pending.prefix(upTo: newline)
                pending.removeSubrange(...newline)
                return Data(frame)
            }
            guard pending.count <= 8192 else { throw AccountInputFailure.input }
            try ready(peer, events: Int16(POLLIN))
            var buffer = [UInt8](repeating: 0, count: 1024)
            let count = Darwin.read(peer, &buffer, buffer.count)
            guard count > 0 else { throw AccountInputFailure.socket }
            pending.append(contentsOf: buffer.prefix(count))
        }
    }

    func send(_ data: Data) throws {
        guard data.count <= 8192 else { throw AccountInputFailure.input }
        var offset = 0
        while offset < data.count {
            try ready(peer, events: Int16(POLLOUT))
            let count = data.withUnsafeBytes { bytes in
                Darwin.write(peer, bytes.baseAddress?.advanced(by: offset), data.count - offset)
            }
            guard count > 0 else { throw AccountInputFailure.socket }
            offset += count
        }
    }

    private func ready(_ descriptor: Int32, events: Int16) throws {
        let remaining = deadline - ProcessInfo.processInfo.systemUptime
        guard descriptor >= 0, remaining > 0 else { throw AccountInputFailure.deadline }
        var item = pollfd(fd: descriptor, events: events, revents: 0)
        let result = poll(&item, 1, Int32(min(remaining * 1000, 120_000)))
        guard result > 0 else { throw AccountInputFailure.deadline }
        guard item.revents & events != 0,
            item.revents & Int16(POLLERR | POLLNVAL) == 0
        else { throw AccountInputFailure.socket }
    }

    func close() {
        if peer >= 0 {
            Darwin.close(peer)
            peer = -1
        }
        if listener >= 0 {
            Darwin.close(listener)
            listener = -1
        }
        var current = stat()
        if let owned = socketIdentity, lstat(socketPath, &current) == 0,
            current.st_dev == owned.st_dev, current.st_ino == owned.st_ino,
            current.st_uid == getuid(), current.st_mode & S_IFMT == S_IFSOCK
        {
            unlink(socketPath)
        }
        socketIdentity = nil
        _ = FileManager.default.changeCurrentDirectoryPath(originalDirectory)
        rmdir(directory.path)
    }
}
