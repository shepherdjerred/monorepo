import UIKit
import React

/// UIScene lifecycle adoption. The iOS 27 SDK traps at launch
/// (`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`) when an
/// app still uses the classic UIApplication lifecycle — see Apple TN3187.
/// React Native itself is started by AppDelegate; this scene owns the window
/// and routes deep links (widgets, Siri intents, the dev e2e-config link)
/// through RCTLinkingManager.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
      let factory = appDelegate.reactNativeFactory
    else {
      fatalError("SceneDelegate connected before AppDelegate initialized React Native")
    }

    let window = UIWindow(windowScene: windowScene)
    factory.startReactNative(
      withModuleName: "TasksForObsidian",
      in: window,
      launchOptions: appDelegate.launchOptions
    )
    self.window = window
    // Libraries (and our widget/live-activity bridges) still reach the
    // window through the app delegate.
    appDelegate.window = window

    // Cold-start deep link / user activity delivered with the connection.
    for context in connectionOptions.urlContexts {
      _ = RCTLinkingManager.application(
        UIApplication.shared, open: context.url, options: [:])
    }
    for activity in connectionOptions.userActivities {
      _ = RCTLinkingManager.application(
        UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
    if let shortcutItem = connectionOptions.shortcutItem {
      _ = handleShortcut(shortcutItem)
    }
  }

  /// Home Screen quick actions (long-press app icon) → deep links.
  /// Types are declared in Info.plist under UIApplicationShortcutItems.
  private func handleShortcut(_ item: UIApplicationShortcutItem) -> Bool {
    let urlByType = [
      "red.sjer.tasksforobsidian.quick-add": "tasknotes://quick-add",
      "red.sjer.tasksforobsidian.today": "tasknotes://today"
    ]
    guard let urlString = urlByType[item.type], let url = URL(string: urlString)
    else { return false }
    return RCTLinkingManager.application(
      UIApplication.shared, open: url, options: [:])
  }

  func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    completionHandler(handleShortcut(shortcutItem))
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = RCTLinkingManager.application(
        UIApplication.shared, open: context.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = RCTLinkingManager.application(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
