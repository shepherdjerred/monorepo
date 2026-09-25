import MacroSupport
import SwiftSyntax
import SwiftSyntaxMacros

/// `@State`, which Xcode 27's SwiftUI declares as a macro rather than a
/// property wrapper.
///
/// Xcode's plugin chooses between two expansions, reproduced here exactly:
///
/// * **Stored-once storage** — a `private`/`fileprivate` property with a
///   written type and an initial value (explicit, from `@State(initialValue:)`,
///   or the implicit `nil` of an optional). Storage is a
///   `State._makeStorage` box in `__name`; `_name` is a computed `State<T>!`
///   view of it; the initial value is also parked in a static so an
///   `init(initialValue: nil)` can restore it.
/// * **Wrapper storage** — everything else. `_name` is an ordinary stored
///   `State<T>` exactly as the property-wrapper era produced.
///
/// Both give `name` an accessor block over the storage and `$name` the
/// projected `Binding`.
public enum StateMacro: AccessorMacro, PeerMacro {
  struct Plan {
    let property: StoredProperty
    /// The initial value, including the implicit `nil` of an optional.
    let initialValue: ExprSyntax?
    /// Whether the initial value was written (on the property or the attribute).
    let initialValueIsWritten: Bool

    init(_ node: AttributeSyntax, _ declaration: some DeclSyntaxProtocol) throws {
      property = try StoredProperty(declaration, macro: "State")
      var fromAttribute: ExprSyntax?
      if case .argumentList(let arguments) = node.arguments, let first = arguments.first {
        guard ["initialValue", "wrappedValue"].contains(first.label?.text) else {
          throw MacroError("@State expects `initialValue:` or `wrappedValue:`")
        }
        fromAttribute = first.expression.trimmed
      }
      if let written = fromAttribute ?? property.initializer {
        initialValue = written
        initialValueIsWritten = true
      } else if property.type?.isOptional == true {
        initialValue = "nil"
        initialValueIsWritten = false
      } else {
        initialValue = nil
        initialValueIsWritten = false
      }
    }

    var usesStoredOnceStorage: Bool {
      ["private", "fileprivate"].contains(property.access) && property.type != nil
        && initialValue != nil
    }
  }

  public static func expansion(
    of node: AttributeSyntax,
    providingAccessorsOf declaration: some DeclSyntaxProtocol,
    in context: some MacroExpansionContext
  ) throws -> [AccessorDeclSyntax] {
    let plan = try Plan(node, declaration)
    let name = plan.property.name
    if plan.usesStoredOnceStorage {
      var accessors: [AccessorDeclSyntax] = []
      if !plan.initialValueIsWritten {
        accessors.append(
          """
          @storageRestrictions(initializes: __\(raw: name))
          init(initialValue) {
              __\(raw: name) = SwiftUICore.State._makeStorage(initialValue: initialValue)
          }
          """)
      }
      accessors.append("get { __\(raw: name).wrappedValue }")
      accessors.append("nonmutating set { __\(raw: name).wrappedValue = newValue }")
      return accessors
    }
    return [
      """
      @storageRestrictions(initializes: _\(raw: name))
      init(initialValue) {
          _\(raw: name) = SwiftUICore.State(initialValue: initialValue)
      }
      """,
      "get { _\(raw: name).wrappedValue }",
      "nonmutating set { _\(raw: name).wrappedValue = newValue }",
    ]
  }

  public static func expansion(
    of node: AttributeSyntax,
    providingPeersOf declaration: some DeclSyntaxProtocol,
    in context: some MacroExpansionContext
  ) throws -> [DeclSyntax] {
    let plan = try Plan(node, declaration)
    let property = plan.property
    let name = property.name
    let access = property.accessPrefix

    guard let initialValue = plan.initialValue else {
      guard let type = property.type else {
        throw MacroError("@State requires a type annotation or an initial value")
      }
      return [
        "private var _\(raw: name): SwiftUICore.State<\(type)>",
        """
        \(raw: access)var $\(raw: name): SwiftUICore.Binding<\(type)> {
            _\(raw: name).projectedValue
        }
        """,
      ]
    }

    guard plan.usesStoredOnceStorage, let type = property.type else {
      let state: DeclSyntax =
        if let type = property.type { "SwiftUICore.State<\(type)>" } else { "SwiftUICore.State" }
      return [
        "private var _\(raw: name) = \(state)(initialValue: \(initialValue))",
        """
        @SwiftUICore._PropertyWrapperProjectedValue
        \(raw: access)var $\(raw: name) = \(state)(initialValue: \(initialValue)).projectedValue
        """,
      ]
    }

    let lazyStorage =
      "SwiftUICore.State._makeStorage(({ let value: \(type) = \(initialValue)\nreturn value }))"
    // What `init(initialValue: nil)` restores. Xcode re-evaluates a written
    // initial value lazily and an implicit `nil` eagerly.
    let restoredStorage: String =
      plan.initialValueIsWritten
      ? lazyStorage
      : "SwiftUICore.State._makeStorage(initialValue: { let x: \(type) = \(initialValue)\nreturn x }())"
    let initialStoredValue = context.makeUniqueName("_initialStoredValue_")
    return [
      "private var __\(raw: name) = \(raw: lazyStorage)",
      """
      @SwiftUICore._StatePropertyWrapperStorage(initialValue: \(literal: payload(initialStoredValue.text)))
      private var _\(raw: name): SwiftUICore.State<_>! = SwiftUICore._stateNil(of: {
          SwiftUICore.State<\(type)>(initialValue: \(initialValue))
      })
      """,
      """
      @SwiftUICore._StateProjectedValue
      \(raw: access)var $\(raw: name) = SwiftUICore.State<\(type)>(initialValue: \(initialValue)).projectedValue
      """,
      """
      @SwiftUICore._StateInitialStoredValue(\(literal: payload(restoredStorage)))
      private static var \(initialStoredValue) = (SwiftUICore.State._makeStorage(initialValue: { let x: \(type) = \(initialValue)
      return x }()))
      """,
    ]
  }
}

/// `@_StatePropertyWrapperStorage` on `_name`: presents the `__name` box as a
/// `State<T>`, so `_name = State(initialValue:)` in an initializer still works.
public enum StatePropertyWrapperStorageMacro: AccessorMacro {
  public static func expansion(
    of node: AttributeSyntax,
    providingAccessorsOf declaration: some DeclSyntaxProtocol,
    in context: some MacroExpansionContext
  ) throws -> [AccessorDeclSyntax] {
    let property = try StoredProperty(declaration, macro: "_StatePropertyWrapperStorage")
    let initialStoredValue = try decodePayload(stringArgument(of: node))
    let box = "_\(property.name)"
    return [
      """
      @storageRestrictions(initializes: \(raw: box))
      init(initialValue) {
          if initialValue == nil {
              \(raw: box) = Self.\(raw: initialStoredValue)
          } else {
              \(raw: box) = SwiftUICore.State._makeStorage(initialValue: initialValue.wrappedValue)
          }
      }
      """,
      "get { SwiftUICore.State(initialValue: \(raw: box).wrappedValue) }",
      """
      set {
          if newValue != nil {
              \(raw: box) = SwiftUICore.State._makeStorage(initialValue: newValue.wrappedValue)
          }
      }
      """,
    ]
  }
}

/// `@_StateProjectedValue` on `$name` for stored-once storage.
public enum StateProjectedValueMacro: AccessorMacro {
  public static func expansion(
    of node: AttributeSyntax,
    providingAccessorsOf declaration: some DeclSyntaxProtocol,
    in context: some MacroExpansionContext
  ) throws -> [AccessorDeclSyntax] {
    let property = try StoredProperty(declaration, macro: "_StateProjectedValue")
    return ["get { __\(raw: property.name.dropFirst()).projectedValue }"]
  }
}

/// `@_PropertyWrapperProjectedValue` on `$name` for wrapper storage.
public enum ProjectedValueMacro: AccessorMacro {
  public static func expansion(
    of node: AttributeSyntax,
    providingAccessorsOf declaration: some DeclSyntaxProtocol,
    in context: some MacroExpansionContext
  ) throws -> [AccessorDeclSyntax] {
    let property = try StoredProperty(declaration, macro: "_PropertyWrapperProjectedValue")
    return ["get { _\(raw: property.name.dropFirst()).projectedValue }"]
  }
}

/// `@_StateInitialStoredValue` on the static that remembers the initial value.
public enum StateInitialStoredValueMacro: AccessorMacro {
  public static func expansion(
    of node: AttributeSyntax,
    providingAccessorsOf declaration: some DeclSyntaxProtocol,
    in context: some MacroExpansionContext
  ) throws -> [AccessorDeclSyntax] {
    let storage = try decodePayload(stringArgument(of: node))
    return ["get { \(raw: storage) }"]
  }
}
