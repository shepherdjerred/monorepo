import SwiftUI
import TaskNotesMac

/// The application entry point, and deliberately nothing else.
///
/// Every view, scene body, and command in this app is compiled by *both* build
/// systems: `swift build` for the command line and CI-adjacent checks, and
/// `xcodebuild` for the real `.app`. That only holds because the UI lives in
/// the `TaskNotesMac` library target rather than in the Xcode target. What is
/// left here is the `@main` attribute, which a library cannot carry.
///
/// Keep this file at entry-point scope. Anything with behavior added here is
/// invisible to `swift build`, and therefore to every check that runs without
/// Xcode.
@main
struct TaskNotesApp: App {
    /// Window-scoped navigation. `@State` is the correct owner for an
    /// `@Observable` reference type at the app root — it gives the object the
    /// app's lifetime without the `@StateObject`/`ObservableObject` machinery
    /// that Observation replaced.
    @State private var navigation = NavigationState()

    var body: some Scene {
        WindowGroup {
            RootView(navigation: navigation)
                // `tasknotes://…`. The URL is parsed in `TaskNotesKit`, so an
                // unhandled link is rejected there rather than being routed to
                // some arbitrary default here.
                .onOpenURL { url in
                    navigation.open(url)
                }
                // Without this pair, a `tasknotes://` link opens a *second*
                // window rather than retargeting the one already on screen —
                // verified, not theoretical. `handlesExternalEvents(matching:)`
                // tells the scene it can service external events, and the view
                // modifier tells SwiftUI an existing window already matches, so
                // no new one is created.
                .handlesExternalEvents(preferring: ["*"], allowing: ["*"])
        }
        .handlesExternalEvents(matching: ["*"])
        // Restores window size, position, and screen across launches. Required
        // by the definition of done, and one line.
        .defaultSize(width: 1100, height: 720)
        .commands {
            TaskNotesCommands(navigation: navigation)
        }

        // Contributes the standard "Settings…" item at `⌘,` in the app menu,
        // in the correct position. Never declare that shortcut by hand.
        Settings {
            SettingsView()
        }
    }
}
