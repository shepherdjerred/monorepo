import Testing
import XCTest

@testable import HelloSwiftUI

/// Swift Testing, against the host app's module.
@Test func greetingIsBuiltOnLinux() {
  #expect(ContentView.title == "Built on Linux")
}

/// XCTest, for projects that still use it.
final class HelloXCTests: XCTestCase {
  func testTitleIsNotEmpty() {
    XCTAssertFalse(ContentView.title.isEmpty)
  }
}
