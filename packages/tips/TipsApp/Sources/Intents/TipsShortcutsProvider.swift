import AppIntents

struct TipsShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ShowRandomTipIntent(),
            phrases: [
                "Show a random tip in \(.applicationName)",
                "Random tip from \(.applicationName)"
            ],
            shortTitle: "Random Tip",
            systemImageName: "lightbulb"
        )
        AppShortcut(
            intent: GetDailyTipIntent(),
            phrases: [
                "Get today's tip from \(.applicationName)",
                "What's today's tip in \(.applicationName)"
            ],
            shortTitle: "Today's Tip",
            systemImageName: "calendar"
        )
        AppShortcut(
            intent: SearchTipsIntent(),
            phrases: [
                "Search tips in \(.applicationName)",
                "Find a tip in \(.applicationName)"
            ],
            shortTitle: "Search Tips",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: ShowTipForAppIntent(),
            phrases: [
                "Show a tip for an app in \(.applicationName)",
                "Tip for app in \(.applicationName)"
            ],
            shortTitle: "Tip for App",
            systemImageName: "app.badge.checkmark"
        )
    }
}
