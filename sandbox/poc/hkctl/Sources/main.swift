import UIKit
import HomeKit

// hkctl — minimal HomeKit CLI (Mac Catalyst).
// Commands are read from the file at HKCTL_CMD (JSON); results are written to
// HKCTL_OUT and mirrored to stdout. With no command file, dumps the full
// home/room/accessory tree ("list").

struct AccessoryDump: Codable {
  let name: String
  let room: String?
  let manufacturer: String?
  let model: String?
  let reachable: Bool
}
struct HomeDump: Codable {
  let home: String
  let isPrimary: Bool
  let rooms: [String]
  let accessories: [AccessoryDump]
}

struct Command: Codable {
  var list: Bool?
  var renameRooms: [[String]]?      // [old, new]
  var assignRooms: [String: String]? // accessory name -> room name
  var renameAccessories: [[String]]? // [old, new] or [old, new, manufacturer]
  var removeAccessories: [String]?
  var removeRooms: [String]?        // room names ("" matches the unnamed room)
  var dryRun: Bool?
}

final class Runner: NSObject, HMHomeManagerDelegate {
  let manager = HMHomeManager()
  var done = false

  override init() {
    super.init()
    manager.delegate = self
  }

  func homeManagerDidUpdateHomes(_ manager: HMHomeManager) {
    guard !done else { return }
    done = true
    Task { await run() }
  }

  func out(_ s: String) {
    print(s)
    let path = ProcessInfo.processInfo.environment["HKCTL_OUT"] ?? "/tmp/hkctl.out"
    if !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
    if let handle = FileHandle(forWritingAtPath: path) {
      handle.seekToEndOfFile()
      handle.write((s + "\n").data(using: .utf8)!)
    }
  }

  func run() async {
    defer { exit(0) }
    guard let home = manager.primaryHome ?? manager.homes.first else {
      out("ERROR: no homes visible (auth status: \(manager.authorizationStatus.rawValue)) — grant HomeKit access and retry")
      exit(1)
    }

    var cmd = Command(list: true, renameRooms: nil, assignRooms: nil, renameAccessories: nil, removeAccessories: nil, removeRooms: nil, dryRun: nil)
    let cmdPath = ProcessInfo.processInfo.environment["HKCTL_CMD"] ?? "/tmp/hkctl.cmd.json"
    if let data = FileManager.default.contents(atPath: cmdPath) {
      do { cmd = try JSONDecoder().decode(Command.self, from: data) }
      catch { out("ERROR: bad command file: \(error)"); exit(1) }
    }
    let dry = cmd.dryRun ?? false

    // Mutations first (if any), then always dump state.
    for pair in cmd.renameRooms ?? [] {
      guard pair.count == 2, let room = home.rooms.first(where: { $0.name == pair[0] }) else {
        out("SKIP rename-room \(pair): room not found"); continue
      }
      if dry { out("DRY rename-room \(pair[0]) -> \(pair[1])"); continue }
      do { try await room.updateName(pair[1]); out("OK rename-room \(pair[0]) -> \(pair[1])") }
      catch { out("FAIL rename-room \(pair[0]): \(error.localizedDescription)") }
    }
    for pair in cmd.renameAccessories ?? [] {
      guard pair.count >= 2 else { out("SKIP rename-accessory \(pair): bad entry"); continue }
      let candidates = home.accessories.filter { a in
        a.name == pair[0] && (pair.count < 3 || a.manufacturer == pair[2])
      }
      guard candidates.count == 1, let acc = candidates.first else {
        out("SKIP rename-accessory \(pair): \(candidates.count) matches"); continue
      }
      if dry { out("DRY rename-accessory \(pair[0]) -> \(pair[1])"); continue }
      do { try await acc.updateName(pair[1]); out("OK rename-accessory \(pair[0]) -> \(pair[1])") }
      catch { out("FAIL rename-accessory \(pair[0]): \(error.localizedDescription)") }
    }
    for (accName, roomName) in cmd.assignRooms ?? [:] {
      guard let acc = home.accessories.first(where: { $0.name == accName }) else {
        out("SKIP assign \(accName): accessory not found"); continue
      }
      guard let room = home.rooms.first(where: { $0.name == roomName }) else {
        out("SKIP assign \(accName): room \(roomName) not found"); continue
      }
      if acc.room?.uniqueIdentifier == room.uniqueIdentifier {
        out("NOOP assign \(accName): already in \(roomName)"); continue
      }
      if dry { out("DRY assign \(accName) -> \(roomName)"); continue }
      do { try await home.assignAccessory(acc, to: room); out("OK assign \(accName) -> \(roomName)") }
      catch { out("FAIL assign \(accName): \(error.localizedDescription)") }
    }
    for accName in cmd.removeAccessories ?? [] {
      guard let acc = home.accessories.first(where: { $0.name == accName }) else {
        out("SKIP remove \(accName): not found"); continue
      }
      if dry { out("DRY remove \(accName)"); continue }
      do { try await home.removeAccessory(acc); out("OK remove \(accName)") }
      catch { out("FAIL remove \(accName): \(error.localizedDescription)") }
    }
    for roomName in cmd.removeRooms ?? [] {
      guard let room = home.rooms.first(where: { $0.name == roomName }) else {
        out("SKIP remove-room \(roomName.isEmpty ? "(unnamed)" : roomName): not found"); continue
      }
      if dry { out("DRY remove-room \(roomName.isEmpty ? "(unnamed)" : roomName)"); continue }
      do { try await home.removeRoom(room); out("OK remove-room \(roomName.isEmpty ? "(unnamed)" : roomName)") }
      catch { out("FAIL remove-room \(roomName.isEmpty ? "(unnamed)" : roomName): \(error.localizedDescription)") }
    }

    // Dump
    let dumps = manager.homes.map { h in
      HomeDump(
        home: h.name,
        isPrimary: h == manager.primaryHome,
        rooms: h.rooms.map(\.name),
        accessories: h.accessories.map { a in
          AccessoryDump(name: a.name, room: a.room?.name, manufacturer: a.manufacturer, model: a.model, reachable: a.isReachable)
        }
      )
    }
    let enc = JSONEncoder(); enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? enc.encode(dumps), let s = String(data: data, encoding: .utf8) {
      out(s)
    }
  }
}

let runner = Runner()

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
}

class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    config.delegateClass = SceneDelegate.self
    return config
  }

  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    // Watchdog: if HomeKit never calls back (no permission), bail out.
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
      print("ERROR: timed out waiting for HomeKit (permission not granted?)")
      exit(2)
    }
    return true
  }
}

_ = UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
