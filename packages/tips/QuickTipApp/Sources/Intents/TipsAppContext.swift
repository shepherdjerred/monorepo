import Foundation

/// Shared context for accessing AppState from App Intents.
///
/// Set `QuickTipAppContext.shared` in `QuickTipApp.init()` so that intents
/// running in a separate context can access the loaded tip data.
@MainActor
enum QuickTipAppContext {
    static var shared: AppState?
}
