import Foundation
import SwiftSyntax

/// A macro failure the compiler reports at the attribute.
public struct MacroError: Error, CustomStringConvertible {
  public let description: String
  public init(_ description: String) { self.description = description }
}

/// The single-binding stored property a property macro is attached to.
public struct StoredProperty {
  public let name: String
  public let type: TypeSyntax?
  public let initializer: ExprSyntax?
  /// The property's own access keyword (`private`, `public`, …), if written.
  public let access: String?

  public init(_ declaration: some DeclSyntaxProtocol, macro: String) throws {
    guard let variable = declaration.as(VariableDeclSyntax.self),
      variable.bindings.count == 1,
      let binding = variable.bindings.first,
      let identifier = binding.pattern.as(IdentifierPatternSyntax.self)
    else {
      throw MacroError("@\(macro) can only be applied to a single stored property")
    }
    name = identifier.identifier.trimmedDescription
    type = binding.typeAnnotation?.type.trimmed
    initializer = binding.initializer?.value.trimmed
    access =
      variable.modifiers.first { modifier in
        modifier.detail == nil
          && ["private", "fileprivate", "internal", "package", "public", "open"].contains(
            modifier.name.text)
      }?.name.text
  }

  /// The access keyword followed by a space, or nothing for implicit internal.
  public var accessPrefix: String { access.map { "\($0) " } ?? "" }
}

extension TypeSyntax {
  /// `T?`, `T!`, or `Optional<T>`: a stored property of this type with no
  /// initializer is implicitly initialized to `nil`.
  public var isOptional: Bool {
    if self.is(OptionalTypeSyntax.self) || self.is(ImplicitlyUnwrappedOptionalTypeSyntax.self) {
      return true
    }
    if let identifier = self.as(IdentifierTypeSyntax.self) {
      return identifier.name.text == "Optional" && identifier.genericArgumentClause != nil
    }
    if let member = self.as(MemberTypeSyntax.self) {
      return member.name.text == "Optional" && member.baseType.trimmedDescription == "Swift"
    }
    return false
  }

  /// The wrapped type of an optional (`T` for `T?` / `Optional<T>`).
  public var optionalWrapped: TypeSyntax? {
    if let optional = self.as(OptionalTypeSyntax.self) { return optional.wrappedType.trimmed }
    if let generic = self.as(IdentifierTypeSyntax.self), generic.name.text == "Optional",
      let argument = generic.genericArgumentClause?.arguments.first
    {
      return TypeSyntax(fromProtocol: argument.argument.as(TypeSyntax.self))?.trimmed
    }
    return nil
  }
}

/// Encode a string for a macro-to-macro payload. The companion macros each
/// see only their own attribute's syntax, so the outer macro hands them what
/// they need as a string literal that cannot collide with Swift escaping.
public func payload(_ text: String) -> String {
  Data(text.utf8).base64EncodedString()
}

public func decodePayload(_ literal: String) throws -> String {
  guard let data = Data(base64Encoded: literal), let text = String(data: data, encoding: .utf8)
  else {
    throw MacroError("malformed macro payload \(literal)")
  }
  return text
}

/// The single string-literal argument of an attribute, e.g. `@X("…")` or `@X(label: "…")`.
public func stringArgument(of attribute: AttributeSyntax) throws -> String {
  guard case .argumentList(let arguments) = attribute.arguments,
    let literal = arguments.first?.expression.as(StringLiteralExprSyntax.self),
    let segment = literal.segments.first?.as(StringSegmentSyntax.self),
    literal.segments.count == 1
  else {
    throw MacroError("@\(attribute.attributeName.trimmedDescription) expects a string literal")
  }
  return segment.content.text
}
