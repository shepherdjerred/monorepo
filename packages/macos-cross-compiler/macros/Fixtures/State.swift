import SwiftUI
@Observable final class Model { var n = 0 }
struct V: View {
  @State private var a: Int = 1
  @State private var b: String?
  @State var model = Model()
  @State private var c: [Int]
  @State(initialValue: 3) private var d: Int
  init() { _c = State(initialValue: []) }
  var body: some View { Text("\(a) \(b ?? "") \(c.count) \(d)").onTapGesture { a += 1; b = "x"; model.n += 1 } .sheet(isPresented: .constant(false)) { EmptyView() } }
}
extension EnvironmentValues { @Entry var myFlag: Bool = false; @Entry var maybe: String? = nil }
#Preview { V() }
#Preview("Named") { V() }
