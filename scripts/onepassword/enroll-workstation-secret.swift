import Darwin
import Foundation
import Security

private func fail(_ message: String) -> Never {
  fputs("\(message)\n", stderr)
  exit(1)
}

private func usage() -> Never {
  fail(
    "Usage: enroll-workstation-secret.swift --service <keychain-service> --ref <op://vault/item/field> [--paste]"
  )
}

private func parseArguments() -> (service: String, ref: String, paste: Bool) {
  let args = CommandLine.arguments
  var service: String?
  var ref: String?
  var paste = false
  var index = 1
  while index < args.count {
    switch args[index] {
    case "--service":
      index += 1
      guard index < args.count else { usage() }
      service = args[index]
    case "--ref":
      index += 1
      guard index < args.count else { usage() }
      ref = args[index]
    case "--paste":
      paste = true
    default:
      usage()
    }
    index += 1
  }
  guard
    let service, !service.isEmpty,
    let ref, !ref.isEmpty
  else {
    usage()
  }
  return (service, ref, paste)
}

private func readWithOnePassword(_ ref: String) -> String {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  process.arguments = ["op", "read", ref]
  let output = Pipe()
  process.standardOutput = output
  process.standardError = FileHandle.nullDevice

  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    fail("Could not run the 1Password CLI.")
  }

  guard process.terminationStatus == 0 else {
    fail(
      "1Password could not read \(ref) (Touch ID may have been dismissed). Keychain was not changed."
    )
  }
  let data = output.fileHandleForReading.readDataToEndOfFile()
  guard let raw = String(data: data, encoding: .utf8) else {
    fail("1Password returned unreadable output. Keychain was not changed.")
  }
  return raw.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func readPastedValue() -> String {
  var original = termios()
  guard tcgetattr(STDIN_FILENO, &original) == 0 else {
    fail("Could not prepare the terminal for hidden input.")
  }
  var hidden = original
  hidden.c_lflag &= ~tcflag_t(ECHO)
  guard tcsetattr(STDIN_FILENO, TCSANOW, &hidden) == 0 else {
    fail("Could not disable terminal echo.")
  }
  defer {
    _ = tcsetattr(STDIN_FILENO, TCSANOW, &original)
    fputs("\n", stderr)
  }

  fputs("Paste the secret value, then press Return: ", stderr)
  guard let value = readLine(strippingNewline: true) else {
    fail("No input received. Keychain was not changed.")
  }
  return value.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func storeInKeychain(service: String, token: String) {
  let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrAccount as String: NSUserName(),
    kSecAttrService as String: service,
  ]
  let value: [String: Any] = [kSecValueData as String: Data(token.utf8)]
  let updateStatus = SecItemUpdate(query as CFDictionary, value as CFDictionary)
  if updateStatus == errSecSuccess {
    return
  }
  guard updateStatus == errSecItemNotFound else {
    fail("Keychain update failed (OSStatus \(updateStatus)).")
  }

  let item = query.merging(value) { _, replacement in replacement }
  let addStatus = SecItemAdd(item as CFDictionary, nil)
  guard addStatus == errSecSuccess else {
    fail("Keychain add failed (OSStatus \(addStatus)).")
  }
}

private func main() {
  guard isatty(STDIN_FILENO) == 1 else {
    fail("Run this installer in an interactive terminal; do not pipe the secret.")
  }

  let (service, ref, paste) = parseArguments()
  let value = paste ? readPastedValue() : readWithOnePassword(ref)
  guard !value.isEmpty, value.count > 16 else {
    fail("The value is missing or looks truncated. Keychain was not changed.")
  }

  storeInKeychain(service: service, token: value)
  fputs("Stored \(service) in Keychain.\n", stderr)
}

main()
