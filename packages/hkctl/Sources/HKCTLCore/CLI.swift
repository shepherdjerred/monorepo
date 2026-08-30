import Foundation

public enum CLI {
  public static let version = "0.1.0"
  public static let defaultOutputPath = "/tmp/hkctl.out"

  public static let help = """
    hkctl \(version) — inspect and organize Apple HomeKit from the terminal

    USAGE:
      open -n -W <path-to-hkctl.app> --args [OPTIONS] <COMMAND>

    COMMANDS:
      list
      room rename <old> <new>
      room remove <name>
      accessory rename <old> <new> [--manufacturer <name>]
      accessory rename --id <uuid> <new>
      accessory assign <accessory> <room>
      accessory assign --id <uuid> <room>
      accessory remove <name>
      accessory remove --id <uuid>
      apply --file <request.json>

    OPTIONS:
      --home <name>         Select a home by exact name (default: primary home)
      -o, --output <path>   Write the result atomically (default: /tmp/hkctl.out)
      --format <text|json>  Select output format (default: text)
      --json                Shortcut for --format json
      -n, --dry-run         Preview mutations without applying them (default)
      --apply               Apply mutations after all targets pass preflight
      -h, --help            Show this help
      --version             Show the version

    EXAMPLES:
      open -n -W ./hkctl.app --args list --json
      open -n -W ./hkctl.app --args room rename "Guest Room" "Guest Bedroom"
      open -n -W ./hkctl.app --args --apply accessory assign "Desk Lamp" "Office"
      open -n -W ./hkctl.app --args accessory assign --id <uuid> "Office"
      open -n -W ./hkctl.app --args apply --file ./homekit-changes.json --json

    Mutations are always dry-run unless --apply is present. The app must be
    launched through `open`; running its inner executable bypasses the HomeKit
    privacy metadata and macOS terminates it.
    """

  public static func parse(arguments: [String]) throws -> Invocation {
    var parser = GlobalParser()
    let tokens = try parser.parse(arguments: arguments)
    try parser.validate()

    let action: InvocationAction
    if parser.requestedHelp || arguments.isEmpty {
      action = .help
    } else if parser.requestedVersion {
      action = .version
    } else {
      action = try parseAction(tokens: tokens)
    }
    try parser.validate(action: action)
    return parser.invocation(action: action)
  }

  public static func requestedOutputPath(arguments: [String]) -> String {
    var index = 0
    while index < arguments.count {
      let argument = arguments[index]
      if argument == "-o" || argument == "--output", index + 1 < arguments.count {
        return arguments[index + 1]
      }
      if let value = optionValue(argument, name: "--output"), !value.isEmpty {
        return value
      }
      index += 1
    }
    return defaultOutputPath
  }

  public static func requestedOutputFormat(arguments: [String]) -> OutputFormat {
    var format = OutputFormat.text
    var index = 0
    while index < arguments.count {
      let argument = arguments[index]
      if argument == "--json" {
        format = .json
      } else if argument == "--format", index + 1 < arguments.count {
        if let requested = OutputFormat(rawValue: arguments[index + 1]) {
          format = requested
        }
        index += 1
      } else if let value = optionValue(argument, name: "--format"),
        let requested = OutputFormat(rawValue: value)
      {
        format = requested
      }
      index += 1
    }
    return format
  }

  private static func parseAction(tokens: [String]) throws -> InvocationAction {
    guard let command = tokens.first else {
      throw HKCTLError.usage("Missing command. Run with --help for usage.")
    }
    switch command {
    case "list":
      guard tokens.count == 1 else {
        throw HKCTLError.usage("Usage: hkctl list")
      }
      return .list
    case "room":
      return try parseRoom(tokens: tokens)
    case "accessory":
      return try parseAccessory(tokens: tokens)
    case "apply":
      return try parseBatch(tokens: tokens)
    default:
      throw HKCTLError.usage("Unknown command '\(command)'. Run with --help for usage.")
    }
  }

  private static func parseRoom(tokens: [String]) throws -> InvocationAction {
    guard tokens.count >= 2 else {
      throw HKCTLError.usage("Usage: hkctl room <rename|remove> ...")
    }
    switch tokens[1] {
    case "rename":
      guard tokens.count == 4 else {
        throw HKCTLError.usage("Usage: hkctl room rename <old> <new>")
      }
      try requireNonEmpty(tokens[2], label: "old room name")
      try requireNonEmpty(tokens[3], label: "new room name")
      return .operations([.renameRoom(from: tokens[2], to: tokens[3])])
    case "remove":
      guard tokens.count == 3 else {
        throw HKCTLError.usage("Usage: hkctl room remove <name>")
      }
      try requireNonEmpty(tokens[2], label: "room name")
      return .operations([.removeRoom(name: tokens[2])])
    default:
      throw HKCTLError.usage("Unknown room command '\(tokens[1])'.")
    }
  }
}

private extension CLI {
  private static func parseAccessory(tokens: [String]) throws -> InvocationAction {
    guard tokens.count >= 2 else {
      throw HKCTLError.usage("Usage: hkctl accessory <rename|assign|remove> ...")
    }
    switch tokens[1] {
    case "rename":
      return try parseAccessoryRename(tokens: tokens)
    case "assign":
      return try parseAccessoryAssign(tokens: tokens)
    case "remove":
      return try parseAccessoryRemove(tokens: tokens)
    default:
      throw HKCTLError.usage("Unknown accessory command '\(tokens[1])'.")
    }
  }

  private static func parseAccessoryRename(tokens: [String]) throws -> InvocationAction {
    if tokens.count >= 3, isIDOption(tokens[2]) {
      let parsed = try parseIDSelector(tokens: Array(tokens.dropFirst(2)))
      guard parsed.remaining.count == 1 else {
        if parsed.remaining.contains("--manufacturer") {
          throw HKCTLError.usage("--manufacturer cannot be combined with --id.")
        }
        throw HKCTLError.usage("Usage: hkctl accessory rename --id <uuid> <new>")
      }
      let newName = parsed.remaining[0]
      try requireNonEmpty(newName, label: "new accessory name")
      return .operations([.renameAccessory(selector: parsed.selector, to: newName)])
    }
    guard tokens.count == 4 || tokens.count == 6 else {
      throw HKCTLError.usage(
        "Usage: hkctl accessory rename <old> <new> [--manufacturer <name>] or --id <uuid> <new>"
      )
    }
    try requireNonEmpty(tokens[2], label: "old accessory name")
    try requireNonEmpty(tokens[3], label: "new accessory name")
    var manufacturer: String?
    if tokens.count == 6 {
      guard tokens[4] == "--manufacturer" else {
        throw HKCTLError.usage("Expected --manufacturer before '\(tokens[4])'.")
      }
      try requireNonEmpty(tokens[5], label: "manufacturer")
      manufacturer = tokens[5]
    }
    return .operations([
      .renameAccessory(
        selector: .name(tokens[2], manufacturer: manufacturer),
        to: tokens[3]
      )
    ])
  }

  private static func parseAccessoryAssign(tokens: [String]) throws -> InvocationAction {
    if tokens.count >= 3, isIDOption(tokens[2]) {
      let parsed = try parseIDSelector(tokens: Array(tokens.dropFirst(2)))
      guard parsed.remaining.count == 1 else {
        throw HKCTLError.usage("Usage: hkctl accessory assign --id <uuid> <room>")
      }
      let room = parsed.remaining[0]
      try requireNonEmpty(room, label: "room name")
      return .operations([.assignAccessory(selector: parsed.selector, room: room)])
    }
    guard tokens.count == 4 else {
      throw HKCTLError.usage(
        "Usage: hkctl accessory assign <accessory> <room> or --id <uuid> <room>"
      )
    }
    try requireNonEmpty(tokens[2], label: "accessory name")
    try requireNonEmpty(tokens[3], label: "room name")
    return .operations([
      .assignAccessory(selector: .name(tokens[2], manufacturer: nil), room: tokens[3])
    ])
  }

  private static func parseAccessoryRemove(tokens: [String]) throws -> InvocationAction {
    if tokens.count >= 3, isIDOption(tokens[2]) {
      let parsed = try parseIDSelector(tokens: Array(tokens.dropFirst(2)))
      guard parsed.remaining.isEmpty else {
        throw HKCTLError.usage("Usage: hkctl accessory remove --id <uuid>")
      }
      return .operations([.removeAccessory(selector: parsed.selector)])
    }
    guard tokens.count == 3 else {
      throw HKCTLError.usage("Usage: hkctl accessory remove <name> or --id <uuid>")
    }
    try requireNonEmpty(tokens[2], label: "accessory name")
    return .operations([.removeAccessory(selector: .name(tokens[2], manufacturer: nil))])
  }

  private static func parseIDSelector(
    tokens: [String]
  ) throws -> (selector: AccessorySelector, remaining: [String]) {
    guard let option = tokens.first else {
      throw HKCTLError.usage("--id requires a UUID.")
    }
    let id: String
    let remaining: [String]
    if option == "--id" {
      guard tokens.count >= 2 else {
        throw HKCTLError.usage("--id requires a UUID.")
      }
      id = tokens[1]
      remaining = Array(tokens.dropFirst(2))
    } else if let assignedID = optionValue(option, name: "--id") {
      id = assignedID
      remaining = Array(tokens.dropFirst())
    } else {
      throw HKCTLError.usage("Expected --id before the accessory UUID.")
    }
    guard let normalized = UUID(uuidString: id)?.uuidString else {
      throw HKCTLError.usage("--id must be a valid UUID.")
    }
    return (.id(normalized), remaining)
  }

  private static func isIDOption(_ token: String) -> Bool {
    token == "--id" || optionValue(token, name: "--id") != nil
  }

  private static func parseBatch(tokens: [String]) throws -> InvocationAction {
    guard tokens.count == 3, tokens[1] == "--file" else {
      throw HKCTLError.usage("Usage: hkctl apply --file <request.json>")
    }
    try requireNonEmpty(tokens[2], label: "batch request path")
    return .batchFile(tokens[2])
  }

  private static func nextValue(
    after option: String,
    arguments: [String],
    index: inout Int
  ) throws -> String {
    let valueIndex = index + 1
    guard valueIndex < arguments.count else {
      throw HKCTLError.usage("\(option) requires a value.")
    }
    index = valueIndex
    return arguments[valueIndex]
  }

  private static func optionValue(_ argument: String, name: String) -> String? {
    let prefix = "\(name)="
    guard argument.hasPrefix(prefix) else { return nil }
    return String(argument.dropFirst(prefix.count))
  }

  private static func requireNonEmpty(_ value: String, label: String) throws {
    guard !value.isEmpty else {
      throw HKCTLError.usage("The \(label) cannot be empty.")
    }
  }

  private struct GlobalParser {
    var homeName: String?
    var outputPath = CLI.defaultOutputPath
    var outputFormat = OutputFormat.text
    var applyChanges = false
    var explicitDryRun = false
    var requestedHelp = false
    var requestedVersion = false

    mutating func parse(arguments: [String]) throws -> [String] {
      var tokens: [String] = []
      var index = 0
      while index < arguments.count {
        let argument = arguments[index]
        if try !consume(argument, arguments: arguments, index: &index) {
          tokens.append(argument)
        }
        index += 1
      }
      return tokens
    }

    mutating func validate() throws {
      if applyChanges && explicitDryRun {
        throw HKCTLError.usage("--apply and --dry-run cannot be used together.")
      }
      guard !outputPath.isEmpty else {
        throw HKCTLError.usage("--output requires a non-empty path.")
      }
      if let homeName, homeName.isEmpty {
        throw HKCTLError.usage("--home requires a non-empty name.")
      }
    }

    func validate(action: InvocationAction) throws {
      guard applyChanges else { return }
      switch action {
      case .help, .version, .list:
        throw HKCTLError.usage("--apply is valid only for mutation commands.")
      case .operations, .batchFile:
        break
      }
    }

    func invocation(action: InvocationAction) -> Invocation {
      Invocation(
        action: action,
        homeName: homeName,
        outputPath: outputPath,
        outputFormat: outputFormat,
        applyChanges: applyChanges
      )
    }

    private mutating func consume(
      _ argument: String,
      arguments: [String],
      index: inout Int
    ) throws -> Bool {
      switch argument {
      case "-h", "--help":
        requestedHelp = true
      case "--version":
        requestedVersion = true
      case "--json":
        outputFormat = .json
      case "--apply":
        applyChanges = true
      case "-n", "--dry-run":
        explicitDryRun = true
      case "--home":
        homeName = try CLI.nextValue(after: argument, arguments: arguments, index: &index)
      case "-o", "--output":
        outputPath = try CLI.nextValue(after: argument, arguments: arguments, index: &index)
      case "--format":
        let value = try CLI.nextValue(after: argument, arguments: arguments, index: &index)
        outputFormat = try parseFormat(value)
      default:
        return try consumeAssignedOption(argument)
      }
      return true
    }

    private mutating func consumeAssignedOption(_ argument: String) throws -> Bool {
      if let value = CLI.optionValue(argument, name: "--home") {
        homeName = value
        return true
      }
      if let value = CLI.optionValue(argument, name: "--output") {
        outputPath = value
        return true
      }
      if let value = CLI.optionValue(argument, name: "--format") {
        outputFormat = try parseFormat(value)
        return true
      }
      return false
    }

    private func parseFormat(_ value: String) throws -> OutputFormat {
      guard let format = OutputFormat(rawValue: value) else {
        throw HKCTLError.usage("--format must be either 'text' or 'json'.")
      }
      return format
    }
  }
}
