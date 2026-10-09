#if os(macOS)
    import AppKit
    import SwiftUI

    internal struct FacetWindowCloseGuard: NSViewRepresentable {
        let flush: @MainActor () async -> Bool
        func makeNSView(context: Context) -> CloseGuardView { CloseGuardView(flush: flush) }
        func updateNSView(_ view: CloseGuardView, context: Context) { view.proxy.flush = flush }
        static func dismantleNSView(_ view: CloseGuardView, coordinator: ()) { view.detach() }

        internal final class CloseGuardView: NSView {
            let proxy: CloseGuardDelegate
            private weak var attachedWindow: NSWindow?
            init(flush: @escaping @MainActor () async -> Bool) {
                proxy = CloseGuardDelegate(flush: flush)
                super.init(frame: .zero)
            }
            required init?(coder: NSCoder) { nil }
            override func viewDidMoveToWindow() {
                super.viewDidMoveToWindow()
                detach()
                guard let window = unsafe self.window else { return }
                if let current = window.delegate, current.isEqual(proxy) { return }
                proxy.previous = window.delegate
                window.delegate = proxy
                attachedWindow = window
            }
            func detach() {
                if let window = attachedWindow, let current = window.delegate,
                    current.isEqual(proxy)
                {
                    window.delegate = proxy.previous
                }
                attachedWindow = nil
                proxy.previous = nil
            }
        }

        internal final class CloseGuardDelegate: NSObject, NSWindowDelegate {
            weak var previous: (any NSWindowDelegate)?
            var flush: @MainActor () async -> Bool
            private var waiting = false
            private var admitted = false
            init(flush: @escaping @MainActor () async -> Bool) { self.flush = flush }
            func windowShouldClose(_ sender: NSWindow) -> Bool {
                if admitted {
                    admitted = false
                    return previous?.windowShouldClose?(sender) ?? true
                }
                guard !waiting else { return false }
                waiting = true
                _Concurrency.Task {
                    let saved = await flush()
                    waiting = false
                    if saved {
                        admitted = true
                        sender.performClose(nil)
                    }
                }
                return false
            }
            // Forward the native delegate contract on MainActor, without transferring
            // AppKit's non-Sendable delegate through Objective-C dynamic forwarding.
            func windowWillReturnFieldEditor(_ sender: NSWindow, to client: Any?) -> Any? {
                previous?.windowWillReturnFieldEditor?(sender, to: client)
            }
            func windowWillResize(_ sender: NSWindow, to size: NSSize) -> NSSize {
                previous?.windowWillResize?(sender, to: size) ?? size
            }
            func windowWillUseStandardFrame(_ window: NSWindow, defaultFrame frame: NSRect)
                -> NSRect
            { previous?.windowWillUseStandardFrame?(window, defaultFrame: frame) ?? frame }
            func windowShouldZoom(_ window: NSWindow, toFrame frame: NSRect) -> Bool {
                previous?.windowShouldZoom?(window, toFrame: frame) ?? true
            }
            func windowWillReturnUndoManager(_ window: NSWindow) -> UndoManager? {
                previous?.windowWillReturnUndoManager?(window)
            }
            func window(_ window: NSWindow, willPositionSheet sheet: NSWindow, using rect: NSRect)
                -> NSRect
            { previous?.window?(window, willPositionSheet: sheet, using: rect) ?? rect }
            func window(_ window: NSWindow, shouldPopUpDocumentPathMenu menu: NSMenu) -> Bool {
                previous?.window?(window, shouldPopUpDocumentPathMenu: menu) ?? true
            }
            func window(
                _ window: NSWindow, shouldDragDocumentWith event: NSEvent, from location: NSPoint,
                with pasteboard: NSPasteboard
            ) -> Bool {
                previous?.window?(
                    window, shouldDragDocumentWith: event, from: location, with: pasteboard)
                    ?? !window.isDocumentEdited
            }
            func window(_ window: NSWindow, willUseFullScreenContentSize size: NSSize) -> NSSize {
                previous?.window?(window, willUseFullScreenContentSize: size) ?? size
            }
            func window(
                _ window: NSWindow,
                willUseFullScreenPresentationOptions options: NSApplication.PresentationOptions
            ) -> NSApplication.PresentationOptions {
                previous?.window?(window, willUseFullScreenPresentationOptions: options) ?? options
            }
            func customWindowsToEnterFullScreen(for window: NSWindow) -> [NSWindow]? {
                previous?.customWindowsToEnterFullScreen?(for: window)
            }
            func customWindowsToEnterFullScreen(for window: NSWindow, on screen: NSScreen)
                -> [NSWindow]?
            { previous?.customWindowsToEnterFullScreen?(for: window, on: screen) }
            func customWindowsToExitFullScreen(for window: NSWindow) -> [NSWindow]? {
                previous?.customWindowsToExitFullScreen?(for: window)
            }
            func window(
                _ window: NSWindow,
                startCustomAnimationToEnterFullScreenWithDuration duration: TimeInterval
            ) {
                previous?.window?(
                    window, startCustomAnimationToEnterFullScreenWithDuration: duration)
            }
            func window(
                _ window: NSWindow, startCustomAnimationToEnterFullScreenOn screen: NSScreen,
                withDuration duration: TimeInterval
            ) {
                previous?.window?(
                    window, startCustomAnimationToEnterFullScreenOn: screen, withDuration: duration)
            }
            func window(
                _ window: NSWindow,
                startCustomAnimationToExitFullScreenWithDuration duration: TimeInterval
            ) {
                previous?.window?(
                    window, startCustomAnimationToExitFullScreenWithDuration: duration)
            }
            func windowDidFailToEnterFullScreen(_ window: NSWindow) {
                previous?.windowDidFailToEnterFullScreen?(window)
            }
            func windowDidFailToExitFullScreen(_ window: NSWindow) {
                previous?.windowDidFailToExitFullScreen?(window)
            }
            func window(
                _ window: NSWindow,
                willResizeForVersionBrowserWithMaxPreferredSize preferred: NSSize,
                maxAllowedSize allowed: NSSize
            ) -> NSSize {
                previous?.window?(
                    window, willResizeForVersionBrowserWithMaxPreferredSize: preferred,
                    maxAllowedSize: allowed) ?? preferred
            }
            func window(_ window: NSWindow, willEncodeRestorableState state: NSCoder) {
                previous?.window?(window, willEncodeRestorableState: state)
            }
            func window(_ window: NSWindow, didDecodeRestorableState state: NSCoder) {
                previous?.window?(window, didDecodeRestorableState: state)
            }
            func previewRepresentableActivityItems(for window: NSWindow)
                -> [any NSPreviewRepresentableActivityItem]?
            { previous?.previewRepresentableActivityItems?(for: window) }
            func windowForSharingRequest(from window: NSWindow) -> NSWindow? {
                previous?.windowForSharingRequest?(from: window)
            }
            func windowDidResize(_ notification: Notification) {
                previous?.windowDidResize?(notification)
            }
            func windowDidExpose(_ notification: Notification) {
                previous?.windowDidExpose?(notification)
            }
            func windowWillMove(_ notification: Notification) {
                previous?.windowWillMove?(notification)
            }
            func windowDidMove(_ notification: Notification) {
                previous?.windowDidMove?(notification)
            }
            func windowDidBecomeKey(_ notification: Notification) {
                previous?.windowDidBecomeKey?(notification)
            }
            func windowDidResignKey(_ notification: Notification) {
                previous?.windowDidResignKey?(notification)
            }
            func windowDidBecomeMain(_ notification: Notification) {
                previous?.windowDidBecomeMain?(notification)
            }
            func windowDidResignMain(_ notification: Notification) {
                previous?.windowDidResignMain?(notification)
            }
            func windowWillClose(_ notification: Notification) {
                previous?.windowWillClose?(notification)
            }
            func windowWillMiniaturize(_ notification: Notification) {
                previous?.windowWillMiniaturize?(notification)
            }
            func windowDidMiniaturize(_ notification: Notification) {
                previous?.windowDidMiniaturize?(notification)
            }
            func windowDidDeminiaturize(_ notification: Notification) {
                previous?.windowDidDeminiaturize?(notification)
            }
            func windowDidUpdate(_ notification: Notification) {
                previous?.windowDidUpdate?(notification)
            }
            func windowDidChangeScreen(_ notification: Notification) {
                previous?.windowDidChangeScreen?(notification)
            }
            func windowDidChangeScreenProfile(_ notification: Notification) {
                previous?.windowDidChangeScreenProfile?(notification)
            }
            func windowDidChangeBackingProperties(_ notification: Notification) {
                previous?.windowDidChangeBackingProperties?(notification)
            }
            func windowWillBeginSheet(_ notification: Notification) {
                previous?.windowWillBeginSheet?(notification)
            }
            func windowDidEndSheet(_ notification: Notification) {
                previous?.windowDidEndSheet?(notification)
            }
            func windowWillStartLiveResize(_ notification: Notification) {
                previous?.windowWillStartLiveResize?(notification)
            }
            func windowDidEndLiveResize(_ notification: Notification) {
                previous?.windowDidEndLiveResize?(notification)
            }
            func windowWillEnterFullScreen(_ notification: Notification) {
                previous?.windowWillEnterFullScreen?(notification)
            }
            func windowDidEnterFullScreen(_ notification: Notification) {
                previous?.windowDidEnterFullScreen?(notification)
            }
            func windowWillExitFullScreen(_ notification: Notification) {
                previous?.windowWillExitFullScreen?(notification)
            }
            func windowDidExitFullScreen(_ notification: Notification) {
                previous?.windowDidExitFullScreen?(notification)
            }
            func windowWillEnterVersionBrowser(_ notification: Notification) {
                previous?.windowWillEnterVersionBrowser?(notification)
            }
            func windowDidEnterVersionBrowser(_ notification: Notification) {
                previous?.windowDidEnterVersionBrowser?(notification)
            }
            func windowWillExitVersionBrowser(_ notification: Notification) {
                previous?.windowWillExitVersionBrowser?(notification)
            }
            func windowDidExitVersionBrowser(_ notification: Notification) {
                previous?.windowDidExitVersionBrowser?(notification)
            }
            func windowDidChangeOcclusionState(_ notification: Notification) {
                previous?.windowDidChangeOcclusionState?(notification)
            }
        }
    }
#endif
