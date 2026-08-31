import Foundation

public enum Renderer {
  public static func render(report: ExecutionReport, format: OutputFormat) throws -> String {
    switch format {
    case .text:
      renderText(report: report)
    case .json:
      try encodeJSON(report)
    }
  }

  public static func render(error: String, code: Int, format: OutputFormat) throws -> String {
    switch format {
    case .text:
      "ERROR: \(error)\n"
    case .json:
      try encodeJSON(ErrorReport(code: code, error: error))
    }
  }

  public static func renderDiagnostic(
    error message: String,
    code: Int,
    format: OutputFormat
  ) -> String {
    do {
      return try render(error: message, code: code, format: format)
    } catch {
      return
        "ERROR: \(message)\n"
        + "ERROR: Could not render the requested \(format.rawValue) diagnostic: "
        + "\(error.localizedDescription)\n"
    }
  }

  public static func write(_ content: String, to path: String) throws {
    let data = Data(content.utf8)
    do {
      try data.write(to: URL(fileURLWithPath: path), options: .atomic)
    } catch {
      throw HKCTLError.outputFailed("Could not write '\(path)': \(error.localizedDescription)")
    }
  }

  private static func renderText(report: ExecutionReport) -> String {
    var lines = [
      "Home: \(report.home.name)\(report.home.isPrimary ? " (primary)" : "")",
      "Mode: \(report.mode.rawValue)",
    ]
    if !report.results.isEmpty {
      lines.append("")
      for result in report.results {
        lines.append("\(result.status.rawValue.uppercased()): \(result.summary)")
      }
    }
    if let error = report.error {
      lines.append("")
      lines.append("ERROR: \(error)")
    }
    lines.append("")
    lines.append("Rooms (\(report.home.rooms.count)):")
    for room in report.home.rooms.sorted(by: {
      $0.name.localizedStandardCompare($1.name) == .orderedAscending
    }) {
      lines.append("  - \(displayName(room.name))")
    }
    lines.append("")
    lines.append("Accessories (\(report.home.accessories.count)):")
    for accessory in report.home.accessories.sorted(by: accessorySort) {
      let room = accessory.roomName.map(displayName) ?? "Unassigned"
      let manufacturer = accessory.manufacturer ?? "Unknown manufacturer"
      let model = accessory.model ?? "Unknown model"
      let reachability = accessory.reachable ? "reachable" : "unreachable"
      lines.append(
        "  - \(displayName(accessory.name)) — \(room) — \(manufacturer) \(model) — \(reachability) — id \(accessory.id)"
      )
    }
    return "\(lines.joined(separator: "\n"))\n"
  }

  private static func encodeJSON(_ value: some Encodable) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(value)
    guard let output = String(data: data, encoding: .utf8) else {
      throw HKCTLError.outputFailed("Could not encode JSON output as UTF-8.")
    }
    return "\(output)\n"
  }

  private static func displayName(_ name: String) -> String {
    name.isEmpty ? "(unnamed)" : name
  }

  private static func accessorySort(
    left: AccessorySnapshot,
    right: AccessorySnapshot
  ) -> Bool {
    left.name.localizedStandardCompare(right.name) == .orderedAscending
  }
}
