import SwiftUI

@main
struct HelloApp: App {
  var body: some Scene {
    WindowGroup { ContentView() }
  }
}

struct ContentView: View {
  @State private var taps = 0

  var body: some View {
    VStack(spacing: 12) {
      Text("Built on Linux").font(.largeTitle)
      Button("Tapped \(taps) times") { taps += 1 }
    }
    .padding(40)
  }
}

#Preview { ContentView() }
