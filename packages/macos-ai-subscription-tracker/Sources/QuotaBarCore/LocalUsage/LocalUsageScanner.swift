import Foundation

enum LocalLogLocations {
  static func claudeProjectRoots(environment: [String: String], home: URL) -> [URL] {
    if let configured = environment["CLAUDE_CONFIG_DIR"] {
      return splitRoots(configured, home: home, suffix: "projects")
    }
    return [
      home.appendingPathComponent(".claude/projects"),
      home.appendingPathComponent(".config/claude/projects"),
    ]
  }

  static func codexSessionRoots(environment: [String: String], home: URL) -> [URL] {
    guard let configured = environment["CODEX_HOME"] else {
      return [home.appendingPathComponent(".codex/sessions")]
    }
    return splitRoots(configured, home: home, suffix: nil).map {
      $0.appendingPathComponent("sessions")
    }
  }

  static func splitRoots(_ raw: String, home: URL, suffix: String?) -> [URL] {
    raw.split(separator: ",").compactMap { entry in
      let trimmed = entry.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else { return nil }
      var url = expand(trimmed, home: home).standardizedFileURL
      if let suffix, url.lastPathComponent != suffix {
        url = url.appendingPathComponent(suffix)
      }
      return url
    }
  }

  static func expand(_ raw: String, home: URL) -> URL {
    if raw == "~" { return home }
    if raw.hasPrefix("~/") {
      return home.appendingPathComponent(String(raw.dropFirst(2)))
    }
    if raw.hasPrefix("/") { return URL(fileURLWithPath: raw) }
    return home.appendingPathComponent(raw)
  }
}

enum LocalUsageScanner {
  static func scan(
    now: Date,
    timeZone: TimeZone,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    fileManager: FileManager = .default,
    home: URL = FileManager.default.homeDirectoryForCurrentUser,
    catalog override: PricingCatalog? = nil
  ) -> [ProviderID: LocalDailyUsage] {
    let resolved = resolveCatalog(override)
    let context = ScanContext(
      now: now,
      timeZone: timeZone,
      fileManager: fileManager,
      catalog: resolved.catalog,
      pricingUnavailable: resolved.pricingUnavailable
    )
    var usage: [ProviderID: LocalDailyUsage] = [:]
    if let claude = providerUsage(
      provider: .claudeCode,
      roots: LocalLogLocations.claudeProjectRoots(environment: environment, home: home),
      context: context,
      read: ClaudeSessionLog.turns(in:)
    ) {
      usage[.claudeCode] = claude
    }
    if let codex = providerUsage(
      provider: .codex,
      roots: LocalLogLocations.codexSessionRoots(environment: environment, home: home),
      context: context,
      read: CodexSessionLog.turns(in:)
    ) {
      usage[.codex] = codex
    }
    return usage
  }

  private static func resolveCatalog(
    _ override: PricingCatalog?
  ) -> (catalog: PricingCatalog?, pricingUnavailable: Bool) {
    if let override { return (override, false) }
    do {
      return (try PricingCatalog.bundled(), false)
    } catch {
      return (nil, true)
    }
  }

  private static func providerUsage(
    provider: ProviderID,
    roots: [URL],
    context: ScanContext,
    read: (URL) throws -> [UsageTurn]
  ) -> LocalDailyUsage? {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = context.timeZone
    let start = calendar.startOfDay(for: context.now)
    var turns: [UsageTurn] = []
    var unreadable = false
    var sawDirectory = false
    for root in roots {
      guard isDirectory(root, fileManager: context.fileManager) else { continue }
      sawDirectory = true
      for file in jsonlFiles(
        under: root, modifiedOnOrAfter: start, fileManager: context.fileManager)
      {
        unreadable =
          appendTurns(
            of: file,
            into: &turns,
            calendar: calendar,
            now: context.now,
            read: read
          ) || unreadable
      }
    }
    guard sawDirectory else { return nil }
    return LocalUsageMath.summarize(
      provider: provider,
      turns: turns,
      unreadable: unreadable,
      pricingUnavailable: context.pricingUnavailable,
      catalog: context.catalog
    )
  }

  private static func appendTurns(
    of file: URL,
    into turns: inout [UsageTurn],
    calendar: Calendar,
    now: Date,
    read: (URL) throws -> [UsageTurn]
  ) -> Bool {
    do {
      let parsed = try read(file)
      turns.append(contentsOf: parsed.filter { calendar.isDate($0.timestamp, inSameDayAs: now) })
      return false
    } catch {
      return true
    }
  }

  private static func isDirectory(_ url: URL, fileManager: FileManager) -> Bool {
    var isDirectory: ObjCBool = false
    return fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory)
      && isDirectory.boolValue
  }

  private static func jsonlFiles(
    under root: URL,
    modifiedOnOrAfter start: Date,
    fileManager: FileManager
  ) -> [URL] {
    guard
      let enumerator = fileManager.enumerator(
        at: root,
        includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
        options: [.skipsPackageDescendants]
      )
    else { return [] }
    var files: [URL] = []
    while let item = enumerator.nextObject() as? URL {
      if item.lastPathComponent == "archived_sessions" {
        enumerator.skipDescendants()
        continue
      }
      guard item.pathExtension == "jsonl", modified(item, onOrAfter: start) else { continue }
      files.append(item)
    }
    return files
  }

  private static func modified(_ url: URL, onOrAfter start: Date) -> Bool {
    guard
      let values = try? url.resourceValues(forKeys: [
        .isRegularFileKey, .contentModificationDateKey,
      ]),
      values.isRegularFile == true,
      let modified = values.contentModificationDate
    else { return false }
    return modified >= start
  }
}

private struct ScanContext {
  let now: Date
  let timeZone: TimeZone
  let fileManager: FileManager
  let catalog: PricingCatalog?
  let pricingUnavailable: Bool
}
