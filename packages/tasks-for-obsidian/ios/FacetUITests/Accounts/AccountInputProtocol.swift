import Foundation
import TaskNotesKit

enum AccountInputFailure: String, Error {
  case input, ownership, form, focus, deadline, socket
}

enum AccountInputOperation: String { case probe, credentials }

struct AccountInputRequests {
  let operation: AccountInputOperation
  private var seen: Set<String> = []
  mutating func admit(_ request: String, kind: AccountInputCommand.Kind) throws {
    guard operation != .probe || ![.submit, .submitVerification, .connect].contains(kind) else {
      throw AccountInputFailure.input
    }
    guard seen.count < 13, seen.insert(request).inserted else { throw AccountInputFailure.input }
  }
}

struct AccountInputIdentity {
  let schemaVersion = 1
  let sessionID: String
  let runID: String
  let deviceID: String

  init(environment: [String: String]) throws {
    func identifier(_ name: String) throws -> String {
      guard let value = environment[name], let uuid = UUID(uuidString: value) else {
        throw AccountInputFailure.ownership
      }
      return uuid.uuidString.lowercased()
    }
    sessionID = try identifier("FACET_E2E_ACCOUNT_SESSION")
    runID = try identifier("FACET_E2E_RUN_ID")
    deviceID = try identifier("FACET_E2E_SIMULATOR")
    guard environment["SIMULATOR_UDID"]?.lowercased() == deviceID else {
      throw AccountInputFailure.ownership
    }
  }

  func matches(_ command: AccountInputCommand) -> Bool {
    command.schemaVersion == schemaVersion && command.sessionID == sessionID
      && command.runID == runID && command.deviceID == deviceID
  }
}

struct AccountInputCommand: Decodable {
  enum Kind: String, Decodable {
    case fill, submit, observe, connect, finish
    case fillVerification = "fill-verification"
    case submitVerification = "submit-verification"
    case fillVaultPassword = "fill-vault-password"
    case checkpointEmpty = "checkpoint-empty"
    case checkpointEmail = "checkpoint-email"
    case checkpointVaultEmpty = "checkpoint-vault-empty"
  }
  let schemaVersion: Int
  let sessionID: String
  let runID: String
  let deviceID: String
  let requestID: String
  let kind: Kind
  let remoteVaultID: String?
  let profileID: String?
}

struct AccountInputReply: Encodable {
  enum Kind: String, Encodable {
    case ready, filled, submitted, observed, finished, rejected
    case verificationFilled = "verification-filled"
    case verificationSubmitted = "verification-submitted"
    case vaultPasswordFilled = "vault-password-filled"
    case connectSubmitted = "connect-submitted"
    case checkpoint
  }
  let schemaVersion = 1
  let sessionID: String
  let runID: String
  let deviceID: String
  let requestID: String?
  let kind: Kind
  var runnerPID: Int32?
  var stage: String?
  var signInEnabled = false
  var connectEnabled = false
  var disabledCheckpoints: Int?
  var submitActionCount: Int?
  var reason: AccountInputFailure.RawValue?
  var point: String?

  init(_ identity: AccountInputIdentity, kind: Kind, requestID: String? = nil) {
    sessionID = identity.sessionID
    runID = identity.runID
    deviceID = identity.deviceID
    self.kind = kind
    self.requestID = requestID
  }

  private enum CodingKeys: String, CodingKey {
    case schemaVersion, sessionID, runID, deviceID, requestID, kind, runnerPID, stage
    case signInEnabled, connectEnabled, disabledCheckpoints, submitActionCount, reason, busy, point
  }

  func encode(to encoder: any Encoder) throws {
    var output = encoder.container(keyedBy: CodingKeys.self)
    try output.encode(schemaVersion, forKey: .schemaVersion)
    try output.encode(sessionID, forKey: .sessionID)
    try output.encode(runID, forKey: .runID)
    try output.encode(deviceID, forKey: .deviceID)
    try output.encode(kind, forKey: .kind)
    try output.encodeIfPresent(requestID, forKey: .requestID)
    try output.encodeIfPresent(runnerPID, forKey: .runnerPID)
    try output.encodeIfPresent(stage, forKey: .stage)
    try output.encodeIfPresent(disabledCheckpoints, forKey: .disabledCheckpoints)
    try output.encodeIfPresent(submitActionCount, forKey: .submitActionCount)
    try output.encodeIfPresent(reason, forKey: .reason)
    try output.encodeIfPresent(point, forKey: .point)
    switch kind {
    case .checkpoint:
      if point == "vault-empty" {
        try output.encode(false, forKey: .connectEnabled)
      } else {
        try output.encode(false, forKey: .signInEnabled)
      }
    case .ready:
      try output.encode(signInEnabled, forKey: .signInEnabled)
      if stage == "vaults" { try output.encode(connectEnabled, forKey: .connectEnabled) }
    case .filled, .verificationFilled:
      try output.encode(signInEnabled, forKey: .signInEnabled)
    case .vaultPasswordFilled:
      try output.encode(connectEnabled, forKey: .connectEnabled)
    case .observed:
      try output.encode(false, forKey: .busy)
      if stage == "vaults" { try output.encode(connectEnabled, forKey: .connectEnabled) }
    case .submitted, .verificationSubmitted, .connectSubmitted, .finished, .rejected: break
    }
  }
}

struct AccountInputProtocol {
  private let schema: FacetSchema
  let identity: AccountInputIdentity

  init(identity: AccountInputIdentity, bundle: Bundle) throws {
    guard let url = bundle.url(forResource: "account-input.schema", withExtension: "json")
    else { throw AccountInputFailure.input }
    do {
      try self.init(identity: identity, schemaData: Data(contentsOf: url))
    } catch { throw AccountInputFailure.input }
  }

  init(identity: AccountInputIdentity, schemaData: Data) throws {
    self.identity = identity
    do { schema = try FacetSchema(data: schemaData) } catch {
      throw AccountInputFailure.input
    }
  }

  func command(_ data: Data) throws -> AccountInputCommand {
    do {
      try schema.validate(data: data, definition: "command")
      let command = try JSONDecoder().decode(AccountInputCommand.self, from: data)
      guard identity.matches(command) else { throw AccountInputFailure.ownership }
      return command
    } catch let failure as AccountInputFailure { throw failure } catch {
      throw AccountInputFailure.input
    }
  }

  func reply(_ value: AccountInputReply) throws -> Data {
    do {
      let data = try JSONEncoder().encode(value)
      try schema.validate(data: data, definition: "reply")
      guard data.count < 8192 else { throw AccountInputFailure.input }
      return data + Data([10])
    } catch { throw AccountInputFailure.input }
  }
}
