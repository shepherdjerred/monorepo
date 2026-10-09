import Foundation
import SwiftUI
import TaskNotesKit
import UIKit
import XCTest

@testable import TaskNotesFacetUI

final class NativeCheckpointTests: XCTestCase {
  @MainActor func testDelightNativeComponents() async throws {
    for state in FacetDelightGalleryState.allCases {
      for appearance in [UIUserInterfaceStyle.light, .dark] {
        let fixture = try await FacetDelightGalleryFixture.open(state)
        try await render(
          FacetDelightGalleryFrame(fixture: fixture),
          named: "facet-delight-ios-\(state.rawValue)", appearance: appearance,
          size: state.size,
          settling: .milliseconds(350),
          expectedTitle: state.isCapture ? fixture.draft.input : nil,
          ready: state.isCapture ? { fixture.previewIsCurrent } : nil)
        try await fixture.close()
      }
    }
  }

  @MainActor func testDelightAdaptiveComponents() async throws {
    for state in [
      FacetDelightGalleryState.captureParsed, .captureDetails, .settingsRecovery, .completed,
    ] {
      let fixture = try await FacetDelightGalleryFixture.open(state)
      try await render(
        FacetDelightGalleryFrame(fixture: fixture).environment(
          \.dynamicTypeSize, .accessibility3),
        named: "facet-delight-ios-\(state.rawValue)-large-type", appearance: .light,
        size: state.size,
        settling: .milliseconds(350),
        ready: state.isCapture ? { fixture.previewIsCurrent } : nil)
      try await fixture.close()
    }
  }

  @MainActor func testCanonicalNativeGalleryLightAndDark() async throws {
    for state in FacetNativeGalleryState.allCases {
      for appearance in [UIUserInterfaceStyle.light, .dark] {
        let fixture = try FacetNativeGalleryFixture(state)
        try await render(
          FacetNativeGalleryFrame(fixture: fixture),
          named: "facet-native-ios-\(state.rawValue)", appearance: appearance,
          size: state.mobileSize)
      }
    }
  }

  @MainActor func testAdaptiveNativeGallery() async throws {
    for variant in FacetNativeGalleryVariant.allCases where variant != .reducedMotion {
      let fixture = try FacetNativeGalleryFixture(
        variant.state, longLabels: variant == .longLabels)
      try await render(
        FacetNativeGalleryFrame(fixture: fixture, variant: variant),
        named: "facet-native-ios-\(variant.rawValue)", appearance: .light,
        size: variant.mobileSize, highContrast: variant == .highContrast)
    }
  }

  @MainActor func testLightAndDarkNativeList() async throws {
    for appearance in [UIUserInterfaceStyle.light, .dark] {
      let store = try FacetSurfaceFixtures.store(.populated)
      let window = FacetWindowState(store: store)
      window.vocabulary = FacetWindowState.vocabulary(try XCTUnwrap(store.snapshot).tasks)
      try await render(
        FacetNativeWorkspace(store: store, importsFolder: .constant(false), window: window),
        named: "ios-native-list-checkpoint", appearance: appearance)
    }
  }

  @MainActor func testLightAndDarkNativeDetail() async throws {
    for appearance in [UIUserInterfaceStyle.light, .dark] {
      let store = try FacetSurfaceFixtures.store(.relationships)
      let snapshot = try XCTUnwrap(store.snapshot)
      let task = try XCTUnwrap(snapshot.tasks.first)
      try await render(
        FacetTaskEditor(
          store: store, task: task, profileID: snapshot.profileId,
          statuses: store.statuses, priorities: store.priorities),
        named: "ios-native-detail-checkpoint", appearance: appearance)
    }
  }

  @MainActor private func render(
    _ content: some View, named: String, appearance: UIUserInterfaceStyle,
    size: CGSize = CGSize(width: 390, height: 844), highContrast: Bool = false,
    settling: Duration = .milliseconds(150), expectedTitle: String? = nil,
    ready: (() -> Bool)? = nil
  ) async throws {
    let frame = CGRect(origin: .zero, size: size)
    let hosting = UIHostingController(
      rootView: content.environment(\.colorScheme, appearance == .dark ? .dark : .light))
    hosting.traitOverrides.accessibilityContrast = highContrast ? .high : .normal
    let scene = try XCTUnwrap(
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let window = UIWindow(windowScene: scene)
    window.frame = frame
    window.overrideUserInterfaceStyle = appearance
    window.rootViewController = hosting
    window.makeKeyAndVisible()
    defer {
      window.isHidden = true
      window.rootViewController = nil
    }
    hosting.view.frame = frame
    hosting.view.setNeedsLayout()
    hosting.view.layoutIfNeeded()
    try await _Concurrency.Task.sleep(for: settling)
    if let ready {
      let deadline = ContinuousClock.now.advanced(by: .seconds(3))
      while !ready(), ContinuousClock.now < deadline {
        try await _Concurrency.Task.sleep(for: .milliseconds(10))
      }
      guard ready() else {
        XCTFail("Native capture preview did not settle for its current title")
        throw FacetContractError.unsupportedResponse
      }
    }
    hosting.view.layoutIfNeeded()
    if let expectedTitle { XCTAssertEqual(focusedText(in: hosting.view), expectedTitle) }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 2
    format.opaque = true
    format.preferredRange = .standard
    var rendered = false
    let image = UIGraphicsImageRenderer(bounds: frame, format: format).image { _ in
      rendered = hosting.view.drawHierarchy(in: frame, afterScreenUpdates: true)
    }
    XCTAssertTrue(rendered, "UIKit refused the actual native view hierarchy render")
    let data = try XCTUnwrap(image.pngData())
    try assertNonuniform(image)
    XCTAssertGreaterThan(data.count, 1000)
    XCTAssertEqual(image.size.width * image.scale, size.width * 2)
    XCTAssertEqual(image.size.height * image.scale, size.height * 2)
    let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.png")
    attachment.name = named + (appearance == .dark ? ".dark" : ".light")
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  @MainActor private func focusedText(in view: UIView) -> String? {
    if let editor = view as? UITextView, editor.isFirstResponder { return editor.text }
    if let field = view as? UITextField, field.isFirstResponder { return field.text }
    for child in view.subviews {
      if let text = focusedText(in: child) { return text }
    }
    return nil
  }

  @MainActor private func assertNonuniform(_ image: UIImage) throws {
    let bitmap = try XCTUnwrap(image.cgImage)
    XCTAssertEqual(bitmap.bitsPerComponent, 8)
    XCTAssertTrue(bitmap.bitsPerPixel == 32 || bitmap.bitsPerPixel == 24)
    let pixels = try XCTUnwrap(bitmap.dataProvider?.data) as Data
    let pixelStride = bitmap.bitsPerPixel / 8
    var colors: Set<UInt32> = []
    for row in stride(from: 0, to: bitmap.height, by: max(1, bitmap.height / 64)) {
      for column in stride(from: 0, to: bitmap.width, by: max(1, bitmap.width / 64)) {
        let offset = row * bitmap.bytesPerRow + column * pixelStride
        guard offset + 2 < pixels.count else {
          XCTFail("Native bitmap pixel exceeds its provider data")
          return
        }
        colors.insert(
          UInt32(pixels[offset]) << 16 | UInt32(pixels[offset + 1]) << 8
            | UInt32(pixels[offset + 2]))
      }
    }
    XCTAssertGreaterThan(colors.count, 8, "Native hierarchy rendered a blank or uniform bitmap")
  }
}
