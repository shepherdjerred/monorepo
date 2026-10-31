import Foundation
import XCTest

/// Uses only the normal account surface. Errors never include UI text or field values.
@MainActor
struct AccountInputForm {
  enum Stage: String { case credentials, verification, vaults, connected, rejected }
  private struct Credentials {
    let email: XCUIElement
    let password: XCUIElement
    let submit: XCUIElement
  }
  let app: XCUIApplication
  let remoteVaultID: String?
  let profileID: String?
  let willSubmit: () -> Void
  let verificationTiming: AccountInputVerificationTiming

  func open() throws -> Stage {
    let onboarding = app.buttons.matching(identifier: "facet.onboarding.sync")
    let settings = app.buttons.matching(identifier: "facet.settings.open")
    let entry = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        onboarding.firstMatch.exists || settings.firstMatch.exists
      }, object: app)
    guard XCTWaiter.wait(for: [entry], timeout: 20) == .completed else {
      throw AccountInputFailure.form
    }
    if onboarding.firstMatch.exists {
      guard onboarding.count == 1, settings.count == 0 else { throw AccountInputFailure.form }
      try ready(onboarding.element)
      onboarding.element.tap()
    } else {
      guard settings.count == 1 else { throw AccountInputFailure.form }
      try ready(settings.element)
      settings.element.tap()
      let connect = app.buttons.matching(identifier: "Connect Obsidian Sync…")
      guard connect.firstMatch.waitForExistence(timeout: 10), connect.count == 1 else {
        throw AccountInputFailure.form
      }
      try ready(connect.element)
      connect.element.tap()
    }
    guard app.buttons["facet.account.done"].waitForExistence(timeout: 10) else {
      throw AccountInputFailure.form
    }
    let settled = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        app.state == .runningForeground && app.alerts.count == 0
          && !app.descendants(matching: .any)["facet.account.progress"].firstMatch.exists
          && app.buttons["facet.account.done"].exists
          && (app.secureTextFields["facet.account.vault-password"].exists
            || (app.textFields["facet.account.email"].exists
              && app.secureTextFields["facet.account.password"].exists))
      }, object: app)
    guard XCTWaiter.wait(for: [settled], timeout: 20) == .completed else {
      throw AccountInputFailure.form
    }
    return try currentStage()
  }

  func prepareEmptyKeyboard() throws {
    let form = try credentials(verification: false)
    guard !form.submit.isEnabled else { throw AccountInputFailure.form }
    // Before the socket exists: this established helper cannot see session input.
    FacetKeyboardBootstrap.focus(form.email, in: app)
    let current = try credentials(verification: false)
    guard !current.submit.isEnabled else { throw AccountInputFailure.form }
    FacetKeyboardBootstrap.focus(current.password, in: app)
    try keyboardReady(current.password)
  }

  func signInEnabled() throws -> Bool {
    try owner()
    let buttons = app.buttons.matching(identifier: "facet.account.signin")
    guard buttons.count <= 1 else { throw AccountInputFailure.form }
    return buttons.firstMatch.exists && buttons.firstMatch.isEnabled
  }

  func checkpointCredentials() throws {
    try disabled(try credentials(verification: false).submit)
  }

  func fillCredentials() throws {
    try enabled(try credentials(verification: false).submit)
  }

  func submitCredentials() throws {
    let form = try credentials(verification: false)
    try ready(form.submit)
    willSubmit()
    form.submit.tap()
  }

  func fillVerification(expiry: Int64) throws {
    try verificationTiming.requireLive(expiry)
    _ = try credentials(verification: true)
    _ = try unique(app.textFields, "facet.account.code")
    try enabled(try credentials(verification: true).submit)
    try verificationTiming.requireLive(expiry)
  }

  func submitVerification(expiry: Int64) throws {
    let form = try credentials(verification: true)
    try ready(form.submit)
    try verificationTiming.requireLive(expiry)
    willSubmit()
    try verificationTiming.requireLive(expiry)
    form.submit.tap()
  }

  func checkpointVault() throws {
    try disabled(try connectButton())
  }

  func fillVaultPassword() throws {
    try vaultOwner()
    _ = try unique(app.secureTextFields, "facet.account.vault-password")
    try vaultOwner()
    try enabled(try connectButton())
  }

  func connectEnabled() throws -> Bool { try connectButton().isEnabled }

  func connect(_ command: AccountInputCommand) throws {
    guard let remoteVaultID, command.remoteVaultID == remoteVaultID,
      command.profileID == profileID
    else { throw AccountInputFailure.ownership }
    try vaultOwner()
    let button = try connectButton()
    try ready(button)
    willSubmit()
    button.tap()
  }

  func observe(connecting: Bool, mayRequestVerification: Bool) throws -> Stage {
    let settled = XCTNSPredicateExpectation(
      predicate: NSPredicate { _, _ in
        guard app.state == .runningForeground,
          !app.descendants(matching: .any)["facet.account.progress"].firstMatch.exists
        else { return false }
        if app.descendants(matching: .any)["facet.account.error"].firstMatch.exists {
          return true
        }
        if connecting { return !app.buttons["facet.account.done"].exists }
        return (mayRequestVerification && app.textFields["facet.account.code"].exists)
          || app.secureTextFields["facet.account.vault-password"].exists
      }, object: app)
    guard XCTWaiter.wait(for: [settled], timeout: 30) == .completed else {
      throw AccountInputFailure.deadline
    }
    try foreground()
    if app.descendants(matching: .any)["facet.account.error"].firstMatch.exists {
      return .rejected
    }
    if connecting {
      guard app.navigationBars.matching(identifier: "Obsidian Sync").count == 0,
        app.buttons.matching(identifier: "facet.account.done").count == 0,
        app.textFields.matching(identifier: "facet.account.email").count == 0
      else { throw AccountInputFailure.form }
      return .connected
    }
    return try currentStage()
  }

  private func currentStage() throws -> Stage {
    try owner()
    if app.textFields["facet.account.code"].exists {
      _ = try credentials(verification: true)
      return .verification
    }
    if app.secureTextFields["facet.account.vault-password"].exists {
      try vaultOwner()
      return .vaults
    }
    _ = try credentials(verification: false)
    return .credentials
  }

  private func credentials(verification: Bool) throws -> Credentials {
    try owner()
    let email = try unique(app.textFields, "facet.account.email")
    let password = try unique(app.secureTextFields, "facet.account.password")
    let submit = try unique(app.buttons, "facet.account.signin")
    guard app.textFields.matching(identifier: "facet.account.password").count == 0,
      app.textFields.matching(identifier: "facet.account.code").count
        == (verification ? 1 : 0),
      app.secureTextFields.matching(identifier: "facet.account.vault-password").count == 0,
      email.isEnabled, password.isEnabled
    else { throw AccountInputFailure.form }
    return Credentials(email: email, password: password, submit: submit)
  }

  private func vaultOwner() throws {
    try owner()
    _ = try unique(app.secureTextFields, "facet.account.vault-password")
    guard app.textFields.matching(identifier: "facet.account.vault-password").count == 0,
      app.textFields.matching(identifier: "facet.account.email").count == 0,
      app.secureTextFields.matching(identifier: "facet.account.password").count == 0
    else { throw AccountInputFailure.form }
  }

  private func connectButton() throws -> XCUIElement {
    try vaultOwner()
    guard let remoteVaultID else { throw AccountInputFailure.ownership }
    let remote = try unique(app.buttons, "facet.account.vault.\(remoteVaultID)")
    if let profileID { return try unique(app.buttons, "facet.account.reconnect.\(profileID)") }
    return remote
  }

  private func foreground() throws {
    guard app.state == .runningForeground, app.alerts.count == 0 else {
      throw AccountInputFailure.ownership
    }
  }

  private func owner() throws {
    try foreground()
    guard app.navigationBars.matching(identifier: "Obsidian Sync").count == 1,
      app.buttons.matching(identifier: "facet.account.done").count == 1,
      !app.descendants(matching: .any)["facet.account.progress"].firstMatch.exists
    else { throw AccountInputFailure.form }
  }

  private func unique(_ query: XCUIElementQuery, _ identifier: String) throws -> XCUIElement {
    let matches = query.matching(identifier: identifier)
    guard matches.count == 1 else { throw AccountInputFailure.form }
    return matches.element
  }

  private func keyboardReady(_ field: XCUIElement) throws {
    try owner()
    guard field.exists, field.isEnabled, field.isHittable, app.keyboards.count == 1 else {
      throw AccountInputFailure.focus
    }
    let keyboard = app.keyboards.element
    guard keyboard.exists, !keyboard.frame.isEmpty, app.frame.intersects(keyboard.frame) else {
      throw AccountInputFailure.focus
    }
    // This runs while the mounted form is empty. Private values never enter XCTest.
  }

  private func disabled(_ field: XCUIElement) throws {
    try wait(field, predicate: "enabled == false", timeout: 5)
    guard !field.isEnabled else { throw AccountInputFailure.form }
  }

  private func enabled(_ field: XCUIElement) throws {
    try wait(field, predicate: "enabled == true", timeout: 5)
  }

  private func ready(_ field: XCUIElement) throws {
    try wait(
      field, predicate: "exists == true AND enabled == true AND hittable == true", timeout: 10
    )
  }

  private func wait(_ field: XCUIElement, predicate: String, timeout: TimeInterval) throws {
    let check = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: predicate), object: field)
    guard XCTWaiter.wait(for: [check], timeout: timeout) == .completed else {
      throw AccountInputFailure.form
    }
  }
}
