import AppKit

class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDockMenu(_: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        menu.addItem(withTitle: "Browse All Tips", action: nil, keyEquivalent: "")
        return menu
    }
}
