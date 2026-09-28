import Darwin
import Foundation
import Security

private let service = "monorepo-homelab-1password-service-account"

private func fail(_ message: String) -> Never {
  fputs("\(message)\n", stderr)
  exit(1)
}

private func validateWithOnePassword(_ token: String) {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
  process.arguments = ["op", "whoami"]
  var environment = ProcessInfo.processInfo.environment
  environment["OP_SERVICE_ACCOUNT_TOKEN"] = token
  environment.removeValue(forKey: "OP_ACCOUNT")
  environment.removeValue(forKey: "OP_CONNECT_TOKEN")
  process.environment = environment
  process.standardInput = FileHandle.nullDevice
  process.standardOutput = FileHandle.nullDevice
  process.standardError = FileHandle.nullDevice

  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    fail("Could not validate the service account with 1Password CLI.")
  }

  guard process.terminationStatus == 0 else {
    fail("1Password rejected the service account token. Keychain was not changed.")
  }
}

private func storeInKeychain(_ token: String) {
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
    fail("Run this installer in an interactive terminal; do not pipe the token.")
  }

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

  fputs("Paste the full 1Password service account token, then press Return: ", stderr)
  guard let token = readLine(strippingNewline: true), token.hasPrefix("ops_"), token.count > 128 else {
    fail("The token is missing or incomplete. Keychain was not changed.")
  }

  validateWithOnePassword(token)
  storeInKeychain(token)
  fputs("Service account validated and saved in Keychain.\n", stderr)
}

main()
