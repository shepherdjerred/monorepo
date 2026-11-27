public import Foundation

public struct AntigravityProvider: UsageProvider {
  public let id = ProviderID.antigravity
  private let commandRunner: any CommandRunning
  private let executableURL: URL?
  private let planSource: any AntigravityPlanFetching

  public init(
    commandRunner: any CommandRunning,
    executableURL: URL? = nil,
    planSource: any AntigravityPlanFetching
  ) {
    self.commandRunner = commandRunner
    self.executableURL = executableURL
    self.planSource = planSource
  }

  public func fetch() async throws -> UsageSnapshot {
    let executableURL = try executableURL ?? Self.locateExecutable()
    async let planResult = capturePlanSurface { try await planSource.codeAssistData() }
    let result = try await commandRunner.run(
      executableURL: executableURL,
      arguments: ["--print", "/usage", "--output-format", "json", "--print-timeout", "20s"]
    )
    guard result.terminationStatus == 0 else {
      _ = await planResult
      throw QuotaError.providerCommandFailed(id)
    }
    let usage = try Self.parse(data: result.stdout)
    return PlanOutcome(await planResult, parse: Self.parsePlan).applied(to: usage)
  }

  /// `loadCodeAssist` names the Google AI subscription as `paidTier` ("Google AI Pro" or "Google AI Ultra");
  /// an account without one has only `currentTier` (the free "Antigravity" tier).
  public static func parsePlan(data: Data) throws -> PlanInfo? {
    let answer = try JSONDecoder().decode(CodeAssistAnswer.self, from: data)
    let tier = answer.paidTier ?? answer.currentTier
    guard let name = tier?.name else { return nil }
    let cost = monthlyCost(tier: tier, isPaid: answer.paidTier != nil)
    return PlanInfo(name: name, monthlyCostUSD: cost)
  }

  private static func monthlyCost(tier: CodeAssistTier?, isPaid: Bool) -> Int? {
    guard let tier else { return nil }
    if let id = tier.id {
      switch id {
      case "g1-ultra-tier": return 200
      case "g1-pro-tier": return 20
      case "free-tier": return 0
      default: break
      }
    }
    guard let name = tier.name else { return nil }
    if name.localizedCaseInsensitiveContains("Ultra") {
      return 200
    }
    if name.localizedCaseInsensitiveContains("Pro") {
      return 20
    }
    if !isPaid || name.localizedCaseInsensitiveContains("Free")
      || name.caseInsensitiveCompare("Antigravity") == .orderedSame
    {
      return 0
    }
    return nil
  }

  public static func locateExecutable(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default
  ) throws -> URL {
    var candidates: [URL] = []
    if let path = environment["PATH"] {
      candidates.append(
        contentsOf: path.split(separator: ":").map {
          URL(fileURLWithPath: String($0), isDirectory: true).appendingPathComponent("agy")
        })
    }
    candidates.append(contentsOf: [
      URL(fileURLWithPath: "/opt/homebrew/bin/agy"),
      URL(fileURLWithPath: "/usr/local/bin/agy"),
      homeDirectory.appendingPathComponent(".local/bin/agy"),
      homeDirectory.appendingPathComponent(".local/share/mise/shims/agy"),
    ])
    var inspected: Set<String> = []
    for candidate in candidates where inspected.insert(candidate.standardizedFileURL.path).inserted
    {
      guard !candidate.pathComponents.contains("agent-bin") else { continue }
      if fileManager.isExecutableFile(atPath: candidate.path) { return candidate }
    }
    throw QuotaError.credentialsMissing(.antigravity)
  }

  public static func parse(data: Data, now: Date = .now) throws -> UsageSnapshot {
    let response = try ProviderDecoder.decode(
      AntigravityResponse.self,
      from: data,
      provider: .antigravity
    )
    guard response.status == "SUCCESS", response.command.name == "usage", response.numTurns == 0
    else {
      throw QuotaError.unsupportedResponse(.antigravity)
    }
    let buckets = try response.command.data.validatedBuckets()
    let specifications = [
      AntigravityWindowSpecification(
        id: "gemini-5h",
        label: "Gemini 5-hour",
        model: "Gemini",
        group: "Gemini Models",
        window: "5h"),
      AntigravityWindowSpecification(
        id: "gemini-weekly",
        label: "Gemini weekly",
        model: "Gemini",
        group: "Gemini Models",
        window: "weekly"),
      AntigravityWindowSpecification(
        id: "3p-5h",
        label: "Claude/GPT 5-hour",
        model: "Claude/GPT",
        group: "Claude and GPT models",
        window: "5h"),
      AntigravityWindowSpecification(
        id: "3p-weekly",
        label: "Claude/GPT weekly",
        model: "Claude/GPT",
        group: "Claude and GPT models",
        window: "weekly"),
    ]
    let windows = try specifications.map { specification in
      guard let bucket = buckets[specification.bucketKey] else {
        throw QuotaError.unsupportedResponse(.antigravity)
      }
      guard bucket.remainingFraction.isFinite, 0...1 ~= bucket.remainingFraction,
        let resetAt = ISO8601.parse(bucket.resetTime)
      else {
        throw QuotaError.unsupportedResponse(.antigravity)
      }
      return try UsageWindow.validated(
        id: "antigravity-\(specification.id)",
        label: specification.label,
        kind: .modelScoped(model: specification.model),
        usedPercent: (1 - bucket.remainingFraction) * 100,
        resetAt: resetAt,
        sourceTimestamp: now
      )
    }
    return UsageSnapshot(
      provider: .antigravity,
      windows: windows,
      notes: ["Uses the signed-in Antigravity CLI without reading or storing its token."],
      sourceTimestamp: now
    )
  }
}

private struct AntigravityResponse: Decodable {
  let status: String
  let command: AntigravityCommand
  let numTurns: Int

  enum CodingKeys: String, CodingKey {
    case status
    case command
    case numTurns = "num_turns"
  }
}

private struct AntigravityCommand: Decodable {
  let name: String
  let data: AntigravityData
}

private struct AntigravityData: Decodable {
  let groups: [AntigravityGroup]

  func validatedBuckets() throws -> [String: AntigravityBucket] {
    let expectedGroups: [String: Set<String>] = [
      "Gemini Models": ["5h", "weekly"],
      "Claude and GPT models": ["5h", "weekly"],
    ]
    guard groups.count == expectedGroups.count else {
      throw QuotaError.unsupportedResponse(.antigravity)
    }
    var result: [String: AntigravityBucket] = [:]
    var seenGroups: Set<String> = []
    for group in groups {
      guard let expectedIDs = expectedGroups[group.name], seenGroups.insert(group.name).inserted,
        Set(group.buckets.map(\.window)) == expectedIDs
      else {
        throw QuotaError.unsupportedResponse(.antigravity)
      }
      for bucket in group.buckets {
        guard !bucket.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          result.updateValue(bucket, forKey: "\(group.name)|\(bucket.window)") == nil
        else {
          throw QuotaError.unsupportedResponse(.antigravity)
        }
      }
    }
    return result
  }
}

private struct AntigravityGroup: Decodable {
  let name: String
  let buckets: [AntigravityBucket]
}

private struct AntigravityBucket: Decodable {
  let name: String
  let window: String
  let remainingFraction: Double
  let resetTime: String

  enum CodingKeys: String, CodingKey {
    case name
    case window
    case remainingFraction = "remaining_fraction"
    case resetTime = "reset_time"
  }
}

private struct AntigravityWindowSpecification {
  let id: String
  let label: String
  let model: String
  let group: String
  let window: String

  var bucketKey: String {
    "\(group)|\(window)"
  }
}

private struct CodeAssistAnswer: Decodable {
  let paidTier: CodeAssistTier?
  let currentTier: CodeAssistTier?
}

private struct CodeAssistTier: Decodable {
  let id: String?
  let name: String?
}
