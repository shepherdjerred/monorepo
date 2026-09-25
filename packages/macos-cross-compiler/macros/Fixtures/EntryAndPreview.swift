import SwiftUI
struct G<T>: View {
  @State var a: Int = 1
  @State private var b: T?
  var body: some View { Text("\(a)") }
}
public struct P: View {
  public init() {}
  @State public var pub: Int = 2
  @State(wrappedValue: 5) var w: Int
  @State var inferredOpt: Int? = nil
  public var body: some View { Text("\(pub)") }
}
extension Transaction { @Entry var tflag: Bool = false }
extension ContainerValues { @Entry var cflag: Int = 0 }
extension FocusedValues { @Entry var fval: String? }
extension EnvironmentValues { @Entry var noType = 3 }
#Preview(traits: .sizeThatFitsLayout) { @Previewable @State var n = 1; Text("\(n)") }
