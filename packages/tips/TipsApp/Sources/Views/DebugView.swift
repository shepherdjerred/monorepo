import AppKit
import SwiftUI
import UserNotifications

#if DEBUG
    /// Debug panel available as a tab in Settings during development.
    struct DebugView: View {
        // MARK: Internal

        var appState: AppState

        var body: some View {
            Form {
                self.stateSection
                self.actionsSection
                self.dangerSection
            }
            .formStyle(.grouped)
        }

        // MARK: Private

        @State private var showResetConfirmation = false

        private var unseenCount: Int {
            let allIds = Set(self.appState.allTips.map(\.id))
            let tracked = Set(self.appState.reviewManager.states.keys)
            let untrackedCount = allIds.subtracting(tracked).count
            let unseenTracked = self.appState.reviewManager.states.values
                .count(where: { $0.status == .unseen })
            return untrackedCount + unseenTracked
        }

        private var showAgainCount: Int {
            self.appState.reviewManager.states.values
                .count(where: { $0.status == .showAgain })
        }

        private var stateSection: some View {
            Section("State") {
                LabeledContent("Content directory") {
                    Text(self.appState.contentDirectoryPath)
                        .textSelection(.enabled)
                        .font(.caption.monospaced())
                }
                LabeledContent("Tips loaded", value: "\(self.appState.allTips.count)")
                LabeledContent("Apps loaded", value: "\(self.appState.apps.count)")
                LabeledContent("Unseen") {
                    Text("\(self.unseenCount)")
                }
                LabeledContent("Learned") {
                    Text("\(self.appState.reviewManager.learnedCount)")
                }
                LabeledContent("Show Again") {
                    Text("\(self.showAgainCount)")
                }
                LabeledContent("Favorites") {
                    Text("\(self.appState.reviewManager.favoriteIds.count)")
                }
            }
        }

        private var actionsSection: some View {
            Section("Actions") {
                self.basicActions
                self.advancedActions
            }
        }

        private var basicActions: some View {
            Group {
                Button("Force Reload Tips") {
                    self.appState.reloadTips()
                }

                Button("Advance to Next Day") {
                    UserDefaults.standard.removeObject(forKey: "lastShownDate")
                    self.appState.selectDailyTip()
                }

                Button("Copy Log Stream Command") {
                    let command =
                        "log stream --predicate 'subsystem == \"com.jerred.TipsApp\"' --level debug"
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(command, forType: .string)
                }
            }
        }

        private var advancedActions: some View {
            Group {
                Button("Open Data Directory") {
                    let dir = FileManager.default
                        .urls(for: .applicationSupportDirectory, in: .userDomainMask)
                        .first?
                        .appendingPathComponent("TipsApp", isDirectory: true)
                    if let dir {
                        NSWorkspace.shared.open(dir)
                    }
                }

                Button("Export State to Clipboard") {
                    self.exportStateToClipboard()
                }

                Button("Simulate Notification") {
                    self.simulateNotification()
                }
            }
        }

        private var dangerSection: some View {
            Section("Danger Zone") {
                Button("Reset All State", role: .destructive) {
                    self.showResetConfirmation = true
                }
                .alert("Reset All State?", isPresented: self.$showResetConfirmation) {
                    Button("Cancel", role: .cancel) {}
                    Button("Reset", role: .destructive) {
                        self.resetAllState()
                    }
                } message: {
                    Text("This will clear all preferences and tip state.")
                }
            }
        }

        private func simulateNotification() {
            guard let tip = self.appState.currentTip else {
                return
            }
            let content = UNMutableNotificationContent()
            content.title = "\(tip.appName) Tip"
            content.subtitle = tip.category
            content.body = tip.formattedText
            content.sound = .default
            let request = UNNotificationRequest(
                identifier: "debug-\(UUID().uuidString)",
                content: content,
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
            )
            UNUserNotificationCenter.current().add(request)
        }

        private func exportStateToClipboard() {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            guard let data = try? encoder.encode(self.appState.reviewManager.states),
                  let json = String(data: data, encoding: .utf8)
            else {
                return
            }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(json, forType: .string)
        }

        private func resetAllState() {
            // Clear relevant UserDefaults keys
            let keys = [
                "hasCompletedOnboarding",
                "lastShownDate",
                "launchAtLogin",
                "notificationsEnabled",
                "notificationHour",
                "notificationMinute"
            ]
            for key in keys {
                UserDefaults.standard.removeObject(forKey: key)
            }

            // Delete tip state file
            let stateFile = FileManager.default
                .urls(for: .applicationSupportDirectory, in: .userDomainMask)
                .first?
                .appendingPathComponent("TipsApp/tip_state.json")
            if let stateFile {
                try? FileManager.default.removeItem(at: stateFile)
            }

            // Reload tips to reset in-memory state
            self.appState.reloadTips()
        }
    }
#endif
