import Foundation
import React

@objc(WidgetBridge)
class WidgetBridge: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func updateWidgetData(_ data: NSDictionary) {
    guard let jsonData = try? JSONSerialization.data(withJSONObject: data, options: []) else {
      return
    }
    let defaults = UserDefaults(suiteName: "group.com.tasksforobsidian")
    defaults?.set(jsonData, forKey: "widgetData")
    defaults?.synchronize()

    if #available(iOS 14.0, *) {
      DispatchQueue.main.async {
        if #available(iOS 14.0, *) {
          // WidgetKit import is only available in the widget target;
          // use dynamic class loading to avoid linking error in the main app.
          if let widgetCenter = NSClassFromString("WidgetCenter") as? NSObject.Type,
             let shared = widgetCenter.value(forKey: "shared") as? NSObject {
            shared.perform(NSSelectorFromString("reloadAllTimelines"))
          }
        }
      }
    }
  }
}
