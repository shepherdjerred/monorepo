import MacroSupport
import SwiftSyntax
import SwiftSyntaxMacros

/// `#Preview { <SwiftUI view> }`: a `PreviewRegistry` type Xcode's canvas
/// discovers at runtime. It is emitted in every configuration, as Xcode does;
/// nothing references it from app code.
///
/// `@Previewable` declarations in the body become stored properties of a
/// wrapper view, so `@Previewable @State var n = 1` gets real view storage.
public enum SwiftUIView: DeclarationMacro {
  public static func expansion(
    of node: some FreestandingMacroExpansionSyntax,
    in context: some MacroExpansionContext
  ) throws -> [DeclSyntax] {
    guard let body = node.trailingClosure else {
      throw MacroError("#Preview requires a trailing closure body")
    }
    guard let location = context.location(of: node, at: .afterLeadingTrivia, filePathMode: .fileID)
    else {
      throw MacroError("#Preview has no source location")
    }
    let arguments = node.arguments.trimmedDescription
    let previewCall = arguments.isEmpty ? "DeveloperToolsSupport.Preview" : "DeveloperToolsSupport.Preview(\(arguments))"

    var previewables: [String] = []
    var statements: [String] = []
    for item in body.statements {
      if let variable = item.item.as(VariableDeclSyntax.self),
        variable.attributes.contains(where: {
          $0.as(AttributeSyntax.self)?.attributeName.trimmedDescription == "Previewable"
        })
      {
        let stripped = variable.with(
          \.attributes,
          variable.attributes.filter {
            $0.as(AttributeSyntax.self)?.attributeName.trimmedDescription != "Previewable"
          })
        previewables.append(stripped.trimmedDescription)
      } else {
        statements.append(item.trimmedDescription)
      }
    }

    let content: String
    if previewables.isEmpty {
      content = """
        func __b_buildView(@SwiftUI.ViewBuilder body: () -> any SwiftUI.View) -> any SwiftUI.View {
            body()
        }
        return __b_buildView {
            \(statements.joined(separator: "\n"))
        }
        """
    } else {
      content = """
        struct __P_Previewable_Transform_Wrapper: SwiftUI.View {
            \(previewables.joined(separator: "\n"))
            var body: some SwiftUI.View {
            \(statements.joined(separator: "\n"))
            }
        }
        return __P_Previewable_Transform_Wrapper()
        """
    }

    let registry = context.makeUniqueName("PreviewRegistry")
    return [
      """
      @available(iOS 17.0, macOS 14.0, tvOS 17.0, visionOS 1.0, watchOS 10.0, *)
      nonisolated struct \(registry): DeveloperToolsSupport.PreviewRegistry {
          static var fileID: String {
              \(location.file)
          }
          static var line: Int {
              \(location.line)
          }
          static var column: Int {
              \(location.column)
          }

          @MainActor static func makePreview() throws -> DeveloperToolsSupport.Preview {
              \(raw: previewCall) {
                  \(raw: content)
              }
          }
      }
      """
    ]
  }
}
