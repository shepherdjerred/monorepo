public import Foundation

public struct MuseProvider: UsageProvider {
  public let id = ProviderID.muse
  private let commandRunner: any CommandRunning
  private let executableURL: URL?

  /// Quota comes from the signed-in `muse` CLI itself (`muse usage --json`, the
  /// CLI's no-model-turn allowance read). The CLI owns the OAuth credential and
  /// its Keychain item: `muse` rewrites that item on every token refresh, which
  /// resets its ACL, so Brim reading it directly turned every poll during an
  /// active Muse session into a Keychain fight. Asking the CLI keeps Brim out
  /// of the credential entirely — it never reads, stores, or sends the token.
  public init(commandRunner: any CommandRunning, executableURL: URL? = nil) {
    self.commandRunner = commandRunner
    self.executableURL = executableURL
  }

  public func fetch() async throws -> UsageSnapshot {
    let executableURL = try executableURL ?? Self.locateExecutable()
    let result = try await commandRunner.run(
      executableURL: executableURL,
      arguments: ["usage", "--json"]
    )
    guard result.terminationStatus == 0 else {
      throw QuotaError.credentialsMissing(id)
    }
    return try Self.parse(data: result.stdout)
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
          URL(fileURLWithPath: String($0), isDirectory: true).appendingPathComponent("muse")
        })
    }
    candidates.append(contentsOf: [
      URL(fileURLWithPath: "/opt/homebrew/bin/muse"),
      URL(fileURLWithPath: "/usr/local/bin/muse"),
      homeDirectory.appendingPathComponent(".local/bin/muse"),
      homeDirectory.appendingPathComponent(".local/share/mise/shims/muse"),
    ])
    var inspected: Set<String> = []
    for candidate in candidates where inspected.insert(candidate.standardizedFileURL.path).inserted
    {
      if fileManager.isExecutableFile(atPath: candidate.path) { return candidate }
    }
    throw QuotaError.credentialsMissing(.muse)
  }

  public static func parse(data: Data, now: Date = .now) throws -> UsageSnapshot {
    let response = try ProviderDecoder.decode(
      MuseUsageResponse.self, from: data, provider: .muse)
    guard let allowance = response.allowance else {
      throw QuotaError.credentialsMissing(.muse)
    }
    var notes = ["Uses the signed-in Muse CLI without reading or storing its token."]
    var windows: [UsageWindow] = []
    if let window = try quotaWindow(
      allowance.window, id: "muse-window", label: "5-hour",
      kind: .rolling(durationSeconds: 300 * 60), notes: &notes, now: now
    ) {
      windows.append(window)
    }
    if let window = try quotaWindow(
      allowance.weekly, id: "muse-weekly", label: "Weekly", kind: .weekly, notes: &notes,
      now: now
    ) {
      windows.append(window)
    }
    guard !windows.isEmpty else { throw QuotaError.unsupportedResponse(.muse) }
    return UsageSnapshot(
      provider: .muse,
      accountLabel: accountLabel(tier: allowance.tier),
      windows: windows.sorted { $0.label < $1.label },
      notes: notes,
      sourceTimestamp: now
    )
  }

  /// A window without a usable percentage is dropped rather than failing the snapshot; a
  /// provider that stops reporting a pool degrades to the pools it still reports.
  private static func quotaWindow(
    _ window: MuseUsageWindow?,
    id: String,
    label: String,
    kind: WindowKind,
    notes: inout [String],
    now: Date
  ) throws -> UsageWindow? {
    // A missing pool drops the window; a present pool with an unusable value fails loudly.
    guard let window, let used = window.usedPercent else { return nil }
    guard used.isFinite, used >= 0 else { throw QuotaValidationError.invalidPercentage }
    let clamped = clampOverQuota(used, notes: &notes)
    return try UsageWindow.validated(
      id: id,
      label: label,
      kind: kind,
      usedPercent: clamped,
      resetAt: resetDate(window.resetsAtMs),
      sourceTimestamp: now
    )
  }

  /// The CLI reports over-quota percentages above 100 verbatim; Brim windows cap at 100
  /// and say so instead of failing the whole snapshot.
  private static func clampOverQuota(_ value: Double, notes: inout [String]) -> Double {
    guard value > 100 else { return value }
    notes.append("Muse reports over-quota usage; shown as fully used.")
    return 100
  }

  private static func resetDate(_ milliseconds: Double?) -> Date? {
    guard let milliseconds, milliseconds.isFinite, milliseconds > 0 else { return nil }
    return Date(timeIntervalSince1970: milliseconds / 1_000)
  }

  private static func accountLabel(tier: String?) -> String? {
    guard let tier = tier?.trimmingCharacters(in: .whitespacesAndNewlines), !tier.isEmpty
    else { return nil }
    return tier
  }
}

private struct MuseUsageResponse: Decodable {
  let allowance: MuseAllowance?
}

private struct MuseAllowance: Decodable {
  let tier: String?
  let window: MuseUsageWindow?
  let weekly: MuseUsageWindow?
}

private struct MuseUsageWindow: Decodable {
  let usedPercent: Double?
  let resetsAtMs: Double?
}
