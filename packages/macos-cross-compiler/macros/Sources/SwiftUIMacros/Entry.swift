import MacroSupport
import SwiftSyntax
import SwiftSyntaxMacros

/// `@Entry` inside an extension of `EnvironmentValues`, `Transaction`,
/// `ContainerValues`, or `FocusedValues`: a private key type plus a
/// subscript-forwarding accessor block.
public enum EntryMacro: AccessorMacro, PeerMacro {
  enum Container: String {
    case environmentValues = "EnvironmentValues"
    case transaction = "Transaction"
    case containerValues = "ContainerValues"
    case focusedValues = "FocusedValues"

    var keyProtocol: String {
      switch self {
      case .environmentValues: "SwiftUICore.EnvironmentKey"
      case .transaction: "SwiftUICore.TransactionKey"
      case .containerValues: "SwiftUICore.ContainerValueKey"
      case .focusedValues: "SwiftUI.FocusedValueKey"
      }
    }
  }

  static func container(_ context: some MacroExpansionContext) throws -> Container {
    for scope in context.lexicalContext {
      if let extensionDecl = scope.as(ExtensionDeclSyntax.self) {
        let name = extensionDecl.extendedType.trimmedDescription.split(separator: ".").last
        if let name, let container = Container(rawValue: String(name)) {
          return container
        }
      }
    }
    throw MacroError(
      "@Entry must be declared in an extension of EnvironmentValues, Transaction, ContainerValues, or FocusedValues"
    )
  }

  public static func expansion(
    of node: AttributeSyntax,
    providingAccessorsOf declaration: some DeclSyntaxProtocol,
    in context: some MacroExpansionContext
  ) throws -> [AccessorDeclSyntax] {
    let property = try StoredProperty(declaration, macro: "Entry")
    let key = "__Key_\(property.name)"
    return [
      "get { self[\(raw: key).self] }",
      "set { self[\(raw: key).self] = newValue }",
      "_modify { yield &self[\(raw: key).self] }",
    ]
  }

  public static func expansion(
    of node: AttributeSyntax,
    providingPeersOf declaration: some DeclSyntaxProtocol,
    in context: some MacroExpansionContext
  ) throws -> [DeclSyntax] {
    let property = try StoredProperty(declaration, macro: "Entry")
    let container = try container(context)
    let key = "__Key_\(property.name)"

    if container == .focusedValues {
      guard let wrapped = property.type?.optionalWrapped else {
        throw MacroError("@Entry in FocusedValues requires an optional type")
      }
      return [
        """
        private struct \(raw: key): \(raw: container.keyProtocol) {
            typealias Value = \(wrapped)
        }
        """
      ]
    }

    let initialValue: ExprSyntax
    if let written = property.initializer {
      initialValue = written
    } else if property.type?.isOptional == true {
      initialValue = "nil"
    } else {
      throw MacroError("@Entry requires a default value")
    }
    let typeAnnotation = property.type.map { ": \($0.trimmedDescription)" } ?? ""
    return [
      """
      private struct \(raw: key): \(raw: container.keyProtocol) {
          @SwiftUICore.__EntryDefaultValue
          static var defaultValue\(raw: typeAnnotation) = \(initialValue)
      }
      """
    ]
  }
}

/// `@__EntryDefaultValue`: turns the key's `defaultValue` into a computed
/// property, so the default is evaluated on each read rather than stored as a
/// (non-`Sendable`-checkable) global.
public enum EntryDefaultValueMacro: AccessorMacro {
  public static func expansion(
    of node: AttributeSyntax,
    providingAccessorsOf declaration: some DeclSyntaxProtocol,
    in context: some MacroExpansionContext
  ) throws -> [AccessorDeclSyntax] {
    let property = try StoredProperty(declaration, macro: "__EntryDefaultValue")
    guard let initialValue = property.initializer else {
      throw MacroError("@__EntryDefaultValue requires an initial value")
    }
    return ["get { \(initialValue) }"]
  }
}
