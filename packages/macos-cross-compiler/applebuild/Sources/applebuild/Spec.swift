import Foundation
import Yams

/// The subset of an XcodeGen `project.yml` that describes one application
/// target. Anything the spec uses that this tool does not implement is an
/// error, never silently ignored: a build that quietly drops a setting is
/// worse than one that refuses to start.
struct ProjectSpec {
  let root: URL
  let raw: [String: Any]

  init(path: URL) throws {
    root = path.deletingLastPathComponent()
    guard let raw = try Yams.load(yaml: String(contentsOf: path, encoding: .utf8)) as? [String: Any]
    else {
      throw BuildError("\(path.path) is not a YAML mapping")
    }
    self.raw = raw
  }

  var options: [String: Any] { raw["options"] as? [String: Any] ?? [:] }

  /// Local package name → absolute path.
  func localPackages() throws -> [String: URL] {
    var packages: [String: URL] = [:]
    for (name, value) in raw["packages"] as? [String: Any] ?? [:] {
      guard let package = value as? [String: Any], let path = package["path"] as? String else {
        throw BuildError("package \(name): only local `path:` packages are supported")
      }
      packages[name] = root.appendingPathComponent(path).standardizedFileURL
    }
    return packages
  }

  func target(_ name: String) throws -> [String: Any] {
    guard let targets = raw["targets"] as? [String: Any], let target = targets[name] as? [String: Any]
    else {
      throw BuildError("project.yml has no target named \(name)")
    }
    return target
  }
}

/// Stringify a YAML scalar the way XcodeGen writes it into a build setting.
func settingString(_ value: Any) throws -> String {
  switch value {
  case let string as String: return string
  case let bool as Bool: return bool ? "YES" : "NO"
  case let int as Int: return String(int)
  case let double as Double: return String(double)
  case let list as [Any]: return try list.map(settingString).joined(separator: " ")
  default: throw BuildError("unsupported build setting value \(value)")
  }
}

/// Xcode build settings for one target and configuration, resolved through
/// the same layers Xcode uses (lowest first): platform defaults, XcodeGen's
/// presets, project `base`, project config, target `base`, target config.
struct BuildSettings {
  private var values: [String: String] = [:]

  init(layers: [[String: String]]) {
    for layer in layers {
      for (key, value) in layer {
        let inherited = values[key] ?? ""
        values[key] = value.replacingOccurrences(of: "$(inherited)", with: inherited)
          .replacingOccurrences(of: "${inherited}", with: inherited)
          .trimmingCharacters(in: .whitespaces)
      }
    }
  }

  subscript(key: String) -> String? {
    values[key].map { expand($0) }
  }

  func bool(_ key: String) -> Bool { self[key] == "YES" }

  func list(_ key: String) -> [String] {
    (self[key] ?? "").split(separator: " ").map(String.init).filter { !$0.isEmpty }
  }

  var all: [String: String] { values.mapValues { expand($0) } }

  /// Expand `$(VAR)`, `${VAR}`, and the operators this repository uses
  /// (`:default=`, `:c99extidentifier`, `:rfc1034identifier`, `:lower`,
  /// `:upper`). An undefined variable expands to "" — Xcode's behaviour.
  func expand(_ text: String, depth: Int = 0) -> String {
    guard depth < 16, text.contains("$(") || text.contains("${") else { return text }
    var result = ""
    var index = text.startIndex
    while index < text.endIndex {
      let character = text[index]
      let next = text.index(after: index)
      if character == "$", next < text.endIndex, text[next] == "(" || text[next] == "{" {
        let close: Character = text[next] == "(" ? ")" : "}"
        var level = 0
        var end = next
        while end < text.endIndex {
          if text[end] == text[next] { level += 1 }
          if text[end] == close {
            level -= 1
            if level == 0 { break }
          }
          end = text.index(after: end)
        }
        guard end < text.endIndex else {
          result.append(contentsOf: text[index...])
          break
        }
        let body = String(text[text.index(after: next)..<end])
        result += evaluate(body, depth: depth)
        index = text.index(after: end)
      } else {
        result.append(character)
        index = next
      }
    }
    return result
  }

  private func evaluate(_ body: String, depth: Int) -> String {
    var parts = body.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    let name = parts.removeFirst()
    var value = values[name].map { expand($0, depth: depth + 1) } ?? ""
    for operation in parts {
      if operation.hasPrefix("default=") {
        if value.isEmpty { value = expand(String(operation.dropFirst("default=".count)), depth: depth + 1) }
      } else if operation == "c99extidentifier" || operation == "identifier" {
        value = String(value.map { $0.isLetter || $0.isNumber || $0 == "_" ? $0 : "_" })
        if let first = value.first, first.isNumber { value = "_" + value }
      } else if operation == "rfc1034identifier" {
        value = String(value.map { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." ? $0 : "-" })
      } else if operation == "lower" {
        value = value.lowercased()
      } else if operation == "upper" {
        value = value.uppercased()
      }
    }
    return value
  }
}

/// Build-setting layers from a spec `settings:` block: `base` plus the
/// matching entry of `configs` (XcodeGen matches config names case-insensitively).
func settingLayers(_ block: Any?, configuration: String) throws -> [[String: String]] {
  guard let block = block as? [String: Any] else { return [] }
  // A `settings:` block without `base`/`configs` is itself the base layer.
  let hasStructure = block["base"] != nil || block["configs"] != nil || block["groups"] != nil
  if block["groups"] != nil { throw BuildError("settings `groups` are not supported") }
  let base = hasStructure ? block["base"] as? [String: Any] ?? [:] : block
  var layers = [try base.mapValues(settingString)]
  if let configs = block["configs"] as? [String: Any],
    let config = configs.first(where: { $0.key.lowercased() == configuration.lowercased() })?.value
      as? [String: Any]
  {
    layers.append(try config.mapValues(settingString))
  }
  return layers
}
