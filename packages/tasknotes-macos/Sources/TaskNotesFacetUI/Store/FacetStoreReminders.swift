import Foundation
import TaskNotesKit

extension FacetStore {
    public var remindersEnabled: Bool {
        UserDefaults.standard.bool(forKey: "Facet.reminders.enabled")
    }

    public func enableReminders() async {
        do {
            guard try await reminders.requestEnable() else {
                throw FacetReminderError.permission
            }
            await refreshReminders()
        } catch { self.error = error.localizedDescription }
    }

    public func disableReminders() async {
        await reminders.disable()
        reminderStatus = "Task reminders are off on this device."
    }

    public func refreshReminders() async {
        guard let engine, remindersEnabled else { return }
        let local = Set(profiles.filter { $0.kind == "local_folder" }.map(\.id))
        do {
            let authorized = try await account?.eligibleReminderProfileIDs() ?? []
            let result = try await reminders.refresh(
                engine: engine, profileIDs: local.union(authorized))
            reminderStatus = "\(result.scheduled) reminders scheduled on this device."
            if result.beyondBudget > 0 {
                reminderStatus =
                    "\(result.scheduled) nearest reminders scheduled; "
                    + "\(result.beyondBudget) await the next device refresh."
            }
            if result.problemCount > 0 {
                reminderStatus =
                    "\(reminderStatus ?? "") \(result.problemCount) reminder settings need correction in their notes."
            }
        } catch is CancellationError {} catch FacetSyncError.cancelled {} catch {
            self.error = error.localizedDescription
        }
    }
}
