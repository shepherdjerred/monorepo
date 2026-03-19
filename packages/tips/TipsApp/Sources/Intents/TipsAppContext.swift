import Foundation

/// Shared context for accessing AppState from App Intents.
///
/// Set `TipsAppContext.shared` in `TipsApp.init()` so that intents
/// running in a separate context can access the loaded tip data.
@MainActor
enum TipsAppContext {
    static var shared: AppState?
}
