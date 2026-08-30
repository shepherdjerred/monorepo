import Foundation
import HKCTLCore
import UIKit

@MainActor
final class AppDelegate: UIResponder, UIApplicationDelegate {
  private var coordinator: AppCoordinator?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    let arguments = Array(CommandLine.arguments.dropFirst())
    do {
      let invocation = try CLI.parse(arguments: arguments)
      let coordinator = AppCoordinator(invocation: invocation)
      self.coordinator = coordinator
      coordinator.start()
    } catch {
      AppCoordinator.finishStartupFailure(
        error: error,
        outputPath: CLI.requestedOutputPath(arguments: arguments),
        outputFormat: CLI.requestedOutputFormat(arguments: arguments)
      )
    }
    return true
  }

  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(
      name: "Default",
      sessionRole: connectingSceneSession.role
    )
    configuration.delegateClass = SceneDelegate.self
    return configuration
  }
}

@MainActor
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
}
