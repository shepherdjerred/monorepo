import PreviewsMacros
import SwiftCompilerPlugin
import SwiftSyntaxMacros
import SwiftUIMacros

@main
struct AppleMacrosPlugin: CompilerPlugin {
  // Macros the SDK declares but this plugin does not provide (`@Animatable`,
  // `@_SwiftUIState`, the UIKit/AppKit `#Preview` overloads, …) are
  // deliberately absent: the compiler then fails the build with "external
  // macro implementation type … could not be found", naming exactly what to
  // implement next.
  let providingMacros: [any Macro.Type] = [
    StateMacro.self,
    StatePropertyWrapperStorageMacro.self,
    StateProjectedValueMacro.self,
    StateInitialStoredValueMacro.self,
    ProjectedValueMacro.self,
    EntryMacro.self,
    EntryDefaultValueMacro.self,
    SwiftUIView.self,
  ]
}
