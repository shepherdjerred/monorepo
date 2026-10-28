#if DEBUG && os(iOS) && targetEnvironment(simulator)
    import Darwin
    import Foundation
    import Security
    import TaskNotesKit

    /// One simulator-only private peer. Frames are never logged or persisted.
    internal actor FacetAcceptanceAccountPeer {
        internal enum Failure: Error { case boundary, peer, form, deadline }
        internal typealias Apply =
            @MainActor @Sendable (FacetAcceptanceInputAction, String?, String) -> Bool
        internal typealias Stage = @MainActor @Sendable () -> String?
        private let identity: [String: String]
        private let endpoint: String
        private let helperPID: pid_t
        private let formEpoch: String
        private let schema: FacetSchema
        private var descriptor: Int32 = -1
        private var audit: Data?
        private var pending = Data()
        private var deadline: TimeInterval = 0
        private var stopped = false
        private var admission: FacetAcceptanceInputAdmission?

        internal init(
            identity: [String: String], endpoint: String, helperPID: pid_t, formEpoch: UUID,
            schema: Data
        ) throws {
            self.identity = identity
            self.endpoint = endpoint
            self.helperPID = helperPID
            self.formEpoch = formEpoch.uuidString.lowercased()
            self.schema = try FacetSchema(data: schema)
        }

        internal func stop() {
            stopped = true
            admission?.invalidate()
            if descriptor >= 0 { Darwin.shutdown(descriptor, SHUT_RDWR) }
        }

        internal func run(stage: Stage, apply: Apply) async throws {
            deadline = ProcessInfo.processInfo.systemUptime + 120
            defer {
                if descriptor >= 0 { Darwin.close(descriptor) }
                descriptor = -1
                pending.removeAll()
            }
            try connectSocket()
            let envelope = try await handshake(stage: stage)
            for _ in 0..<7 {
                let finished = try await applyCommand(
                    envelope: envelope, stage: stage, apply: apply)
                if finished { return }
            }
            throw Failure.boundary
        }

        private func connectSocket() throws {
            descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
            guard descriptor >= 0 else { throw Failure.peer }
            var address = sockaddr_un()
            address.sun_family = sa_family_t(AF_UNIX)
            address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
            let path = Array(endpoint.utf8) + [0]
            guard path.count <= MemoryLayout.size(ofValue: address.sun_path) else {
                throw Failure.boundary
            }
            // Each pointer borrow is confined to its C call; the checked path fits sun_path.
            withUnsafeMutableBytes(of: &address.sun_path) { unsafe $0.copyBytes(from: path) }
            let connected = withUnsafePointer(to: &address) {
                unsafe $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    unsafe Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            guard connected == 0 else { throw Failure.peer }
            var noSignal: Int32 = 1
            guard
                unsafe setsockopt(
                    descriptor, SOL_SOCKET, SO_NOSIGPIPE, &noSignal,
                    socklen_t(MemoryLayout<Int32>.size)) == 0
            else { throw Failure.peer }
            audit = try peer()
        }

        private func handshake(stage: Stage) async throws -> [String: Any] {
            var random = [UInt8](repeating: 0, count: 32)
            guard
                unsafe SecRandomCopyBytes(kSecRandomDefault, random.count, &random)
                    == errSecSuccess,
                let initialStage = await stage()
            else { throw Failure.form }
            let token = random.map { ($0 < 16 ? "0" : "") + String($0, radix: 16) }.joined()
            for index in random.indices { random[index] = 0 }
            var envelope: [String: Any] = identity
            envelope["schemaVersion"] = 1
            envelope["formEpoch"] = formEpoch
            envelope["token"] = token
            try await send(
                envelope.merging(["kind": "hello", "stage": initialStage, "appPID": getpid()]) {
                    _, new in new
                })
            let bind = try await command(envelope: envelope)
            guard bind["kind"] as? String == "bind",
                bind["expectedStage"] as? String == initialStage,
                let firstID = bind["requestID"] as? String
            else { throw Failure.boundary }
            try await send(
                envelope.merging(["kind": "ready", "requestID": firstID, "stage": initialStage]) {
                    _, new in new
                })
            admission = FacetAcceptanceInputAdmission(
                initialStage: initialStage, bindRequest: firstID)
            return envelope
        }

        private func applyCommand(envelope: [String: Any], stage: Stage, apply: Apply) async throws
            -> Bool
        {
            let frame = try await command(envelope: envelope)
            guard let request = frame["requestID"] as? String,
                let rawAction = frame["kind"] as? String,
                let action = FacetAcceptanceInputAction(rawValue: rawAction),
                let expected = frame["expectedStage"] as? String,
                await stage() == expected
            else { throw Failure.boundary }
            try _Concurrency.Task.checkCancellation()
            guard !stopped else { throw Failure.form }
            let admitted =
                admission?.admit(request: request, action: rawAction, stage: expected) == true
            let value = frame["value"] as? String
            guard admitted,
                value.map({ $0.utf8.count <= (action == .email ? 256 : 512) }) ?? true,
                await apply(action, value, expected)
            else { throw Failure.form }
            try _Concurrency.Task.checkCancellation()
            guard !stopped else { throw Failure.form }
            try await send(
                envelope.merging([
                    "kind": "applied", "requestID": request, "stage": expected,
                    "action": rawAction,
                ]) { _, new in new })
            return action == .finish
        }

        private func peer() throws -> Data {
            var user: uid_t = 0
            var group: gid_t = 0
            var pid: pid_t = 0
            var size = socklen_t(MemoryLayout<pid_t>.size)
            guard unsafe getpeereid(descriptor, &user, &group) == 0, user == getuid(),
                unsafe getsockopt(descriptor, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) == 0,
                pid == helperPID
            else { throw Failure.peer }
            var token = audit_token_t()
            size = socklen_t(MemoryLayout<audit_token_t>.size)
            guard unsafe getsockopt(descriptor, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &size) == 0,
                size == MemoryLayout<audit_token_t>.size
            else { throw Failure.peer }
            let actual = withUnsafeBytes(of: &token) { unsafe Data($0) }
            guard audit == nil || audit == actual else { throw Failure.peer }
            return actual
        }

        private func ready(_ event: Int16) async throws {
            while true {
                try _Concurrency.Task.checkCancellation()
                guard !stopped, ProcessInfo.processInfo.systemUptime < deadline else {
                    throw Failure.deadline
                }
                _ = try peer()
                var item = pollfd(fd: descriptor, events: event, revents: 0)
                let count = unsafe poll(&item, 1, 0)
                guard count >= 0 else { throw Failure.peer }
                if count > 0 {
                    guard item.revents & event != 0 else { throw Failure.peer }
                    return
                }
                try await _Concurrency.Task.sleep(for: .milliseconds(20))
            }
        }

        private func command(envelope: [String: Any]) async throws -> [String: Any] {
            while true {
                if let end = pending.firstIndex(of: 10) {
                    guard end > 0 && end <= 8192 else { throw Failure.boundary }
                    let bytes = Data(pending.prefix(upTo: end))
                    pending.removeSubrange(...end)
                    try schema.validate(data: bytes, definition: "app-command")
                    guard
                        let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                        identity.allSatisfy({ value[$0.key] as? String == $0.value }),
                        value["formEpoch"] as? String == envelope["formEpoch"] as? String,
                        value["token"] as? String == envelope["token"] as? String
                    else { throw Failure.boundary }
                    return value
                }
                guard pending.count <= 8192 else { throw Failure.boundary }
                try await ready(Int16(POLLIN))
                var bytes = [UInt8](repeating: 0, count: 1024)
                let count = unsafe Darwin.read(descriptor, &bytes, bytes.count)
                guard count > 0 else { throw Failure.peer }
                pending.append(contentsOf: bytes.prefix(count))
            }
        }

        private func send(_ value: [String: Any]) async throws {
            let bytes = try JSONSerialization.data(withJSONObject: value) + Data([10])
            try schema.validate(data: bytes, definition: "app-reply")
            guard bytes.count <= 8192 else { throw Failure.boundary }
            var offset = 0
            while offset < bytes.count {
                try await ready(Int16(POLLOUT))
                let count = unsafe bytes.withUnsafeBytes {
                    unsafe Darwin.write(
                        descriptor, $0.baseAddress?.advanced(by: offset), bytes.count - offset)
                }
                guard count > 0 else { throw Failure.peer }
                offset += count
            }
        }
    }
#endif
