import Darwin
import Foundation

enum BridgeFailure: String, Error { case boundary, peer, deadline, frame, io }
struct BridgeRejection: Error {
  let reason: BridgeFailure
  let systemError: Int32
}
enum BridgePhase: String { case bootstrap, stdio, directory, socket, peer, authorization, pump }
func physicalPath(_ path: String) -> String? {
  guard let pointer = Darwin.realpath(path, nil) else { return nil }
  defer { free(pointer) }
  return String(cString: pointer)
}
func require(_ condition: Bool, _ failure: BridgeFailure = .boundary) throws {
  if !condition { throw BridgeRejection(reason: failure, systemError: errno) }
}
func packet(_ value: [String: Any]) throws {
  let bytes = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  try FileHandle.standardOutput.write(contentsOf: bytes + Data([10]))
}
func wait(_ descriptor: Int32, events: Int16, deadline: TimeInterval) throws {
  let left = deadline - ProcessInfo.processInfo.systemUptime
  try require(left > 0, .deadline)
  var item = pollfd(fd: descriptor, events: events, revents: 0)
  try require(poll(&item, 1, Int32(min(left * 1000, 120_000))) > 0, .deadline)
  try require(item.revents & events != 0, .io)
}
func writeAll(_ descriptor: Int32, bytes: Data, deadline: TimeInterval) throws {
  var offset = 0
  while offset < bytes.count {
    try wait(descriptor, events: Int16(POLLOUT), deadline: deadline)
    let count = bytes.withUnsafeBytes {
      Darwin.write(descriptor, $0.baseAddress?.advanced(by: offset), bytes.count - offset)
    }
    try require(count > 0, .io)
    offset += count
  }
}
func peerIdentity(_ descriptor: Int32) throws -> (pid_t, uid_t) {
  var user: uid_t = 0
  var group: gid_t = 0
  var pid: pid_t = 0
  var size = socklen_t(MemoryLayout<pid_t>.size)
  try require(getpeereid(descriptor, &user, &group) == 0 && user == getuid(), .peer)
  try require(getsockopt(descriptor, SOL_LOCAL, LOCAL_PEERPID, &pid, &size) == 0 && pid > 0, .peer)
  return (pid, user)
}
func checkedPath(_ currentPhase: inout BridgePhase) throws -> String {
  try require(CommandLine.arguments.count == 2 && getuid() > 0 && getuid() == geteuid())
  currentPhase = .stdio
  for descriptor in [STDIN_FILENO, STDOUT_FILENO] {
    var info = stat()
    try require(
      fstat(descriptor, &info) == 0
        && [mode_t(S_IFIFO), mode_t(S_IFSOCK)].contains(info.st_mode & S_IFMT))
  }
  let path = CommandLine.arguments[1]
  currentPhase = .directory
  let directory = URL(fileURLWithPath: path).deletingLastPathComponent().path
  var metadata = stat()
  try require(
    directory.hasPrefix("/private/tmp/facet-account-") && physicalPath(directory) == directory)
  try require(
    lstat(directory, &metadata) == 0 && metadata.st_uid == getuid()
      && metadata.st_mode & S_IFMT == S_IFDIR && metadata.st_mode & 0o777 == 0o700)
  return path
}
func listenerSocket(_ path: String) throws -> Int32 {
  var address = sockaddr_un()
  let name = Array(path.utf8) + [0]
  try require(name.count <= MemoryLayout.size(ofValue: address.sun_path))
  address.sun_family = sa_family_t(AF_UNIX)
  address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
  withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: name) }
  let listener = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  try require(listener >= 0, .io)
  var ready = false
  defer { if !ready { Darwin.close(listener) } }
  let bound = withUnsafePointer(to: &address) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      Darwin.bind(listener, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  try require(bound == 0 && chmod(path, 0o600) == 0 && listen(listener, 1) == 0, .io)
  ready = true
  return listener
}
func acceptedPeer(_ listener: Int32) throws -> Int32? {
  try packet(["kind": "listening", "pid": getpid(), "uid": getuid()])
  var initial = [
    pollfd(fd: listener, events: Int16(POLLIN), revents: 0),
    pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0),
  ]
  try require(poll(&initial, 2, 120_000) > 0, .deadline)
  if initial[1].revents != 0 {
    var byte: UInt8 = 0
    if Darwin.read(STDIN_FILENO, &byte, 1) == 0 { return nil }
    throw BridgeRejection(reason: .boundary, systemError: errno)
  }
  try require(initial[0].revents & Int16(POLLIN) != 0, .io)
  let peer = Darwin.accept(listener, nil, nil)
  try require(peer >= 0, .io)
  return peer
}
func run(_ currentPhase: inout BridgePhase) throws {
  let path = try checkedPath(&currentPhase)
  currentPhase = .socket
  let listener = try listenerSocket(path)
  defer { Darwin.close(listener) }
  var socketInfo = stat()
  try require(
    lstat(path, &socketInfo) == 0 && socketInfo.st_uid == getuid()
      && socketInfo.st_mode & S_IFMT == S_IFSOCK)
  defer {
    var current = stat()
    if lstat(path, &current) == 0 && current.st_dev == socketInfo.st_dev
      && current.st_ino == socketInfo.st_ino && current.st_uid == getuid()
    {
      unlink(path)
    }
  }
  let deadline = ProcessInfo.processInfo.systemUptime + 120
  currentPhase = .peer
  guard let peer = try acceptedPeer(listener) else { return }
  defer { Darwin.close(peer) }
  var noSignal: Int32 = 1
  try require(
    setsockopt(peer, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size)) == 0,
    .io)
  let owner = try peerIdentity(peer)
  try packet(["kind": "peer", "pid": owner.0, "uid": owner.1])
  currentPhase = .authorization
  try wait(STDIN_FILENO, events: Int16(POLLIN), deadline: deadline)
  var authorized: UInt8 = 0
  try require(Darwin.read(STDIN_FILENO, &authorized, 1) == 1 && authorized == 65, .peer)
  currentPhase = .pump
  try pump(peer, owner: owner.0, deadline: deadline)
}
func pump(_ peer: Int32, owner: pid_t, deadline: TimeInterval) throws {
  var pending = [Data(), Data()]
  var frames = [0, 0]
  while true {
    try require(ProcessInfo.processInfo.systemUptime < deadline, .deadline)
    var items = [
      pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0),
      pollfd(fd: peer, events: Int16(POLLIN), revents: 0),
    ]
    let left = Int32(max(1, min((deadline - ProcessInfo.processInfo.systemUptime) * 1000, 120_000)))
    try require(poll(&items, 2, left) > 0, .deadline)
    for index in 0..<2 where items[index].revents != 0 {
      try require(try peerIdentity(peer).0 == owner, .peer)
      var bytes = [UInt8](repeating: 0, count: 1024)
      let count = Darwin.read(items[index].fd, &bytes, bytes.count)
      if count == 0 { return }
      try require(count > 0, .io)
      pending[index].append(contentsOf: bytes.prefix(count))
      while let newline = pending[index].firstIndex(of: 10) {
        frames[index] += 1
        try require(newline > 0 && newline <= 8192 && frames[index] <= (index == 0 ? 8 : 9), .frame)
        let frame = Data(pending[index].prefix(through: newline))
        try writeAll(index == 0 ? peer : STDOUT_FILENO, bytes: frame, deadline: deadline)
        pending[index].removeSubrange(...newline)
      }
      try require(pending[index].count <= 8192, .frame)
    }
  }
}
func reject(_ failure: BridgeFailure, phase currentPhase: BridgePhase, systemError: Int32) {
  let rejection: [String: Any] = [
    "kind": "rejected", "phase": currentPhase.rawValue, "reason": failure.rawValue,
    "errno": systemError,
  ]
  do {
    let bytes = try JSONSerialization.data(withJSONObject: rejection, options: [.sortedKeys])
    FileHandle.standardError.write(bytes + Data([10]))
  } catch {
    FileHandle.standardError.write(
      Data(
        "{\"kind\":\"rejected\",\"phase\":\"bootstrap\",\"reason\":\"boundary\",\"errno\":0}\n".utf8
      ))
  }
}
var phase = BridgePhase.bootstrap
do { try run(&phase) } catch let failure as BridgeRejection {
  reject(failure.reason, phase: phase, systemError: failure.systemError)
  exit(3)
} catch {
  reject(.boundary, phase: phase, systemError: errno)
  exit(3)
}
