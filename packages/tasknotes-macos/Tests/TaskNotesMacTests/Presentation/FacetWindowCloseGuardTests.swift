import AppKit
import Testing

@testable import TaskNotesFacetUI

@Suite("Native window delegate ownership") @MainActor
struct FacetWindowCloseGuardTests {
    @Test func detachRestoresPreviousDelegateAndPreservesNewerOwner() {
        _ = NSApplication.shared
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 400),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        let original = Delegate()
        let newer = Delegate()
        window.delegate = original
        let view = FacetWindowCloseGuard.CloseGuardView(flush: { true })
        window.contentView = view
        #expect(window.delegate?.isEqual(view.proxy) == true)
        view.detach()
        #expect(window.delegate?.isEqual(original) == true)
        window.contentView = nil
        window.contentView = view
        #expect(window.delegate?.isEqual(view.proxy) == true)
        window.delegate = newer
        view.detach()
        #expect(window.delegate?.isEqual(newer) == true)
        window.contentView = nil
    }

    @Test func proxyForwardsNativeOptionalDefaultAndNotifications() {
        let original = Delegate()
        let proxy = FacetWindowCloseGuard.CloseGuardDelegate(flush: { true })
        proxy.previous = original
        let window = NSWindow(contentRect: .zero, styleMask: [], backing: .buffered, defer: false)
        #expect(proxy.customWindowsToEnterFullScreen(for: window) == nil)
        proxy.windowDidResize(Notification(name: NSWindow.didResizeNotification, object: window))
        #expect(original.resizes == 1)
    }

    private final class Delegate: NSObject, NSWindowDelegate {
        var resizes = 0
        func windowDidResize(_ notification: Notification) { resizes += 1 }
    }
}
