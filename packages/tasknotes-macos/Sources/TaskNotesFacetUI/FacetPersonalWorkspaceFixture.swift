#if DEBUG
    import Foundation
    import TaskNotesKit

    extension FacetStore {
        /// Synthetic personal workspace for native interaction and screenshot tests.
        func seedPersonalWorkspaceFixture() {
            let groceries = localStore.addProject(
                name: "Grocery List", color: "green", isFavorite: true)
            let home = localStore.addProject(name: "Home", color: "blue")
            let task = localStore.addTask(
                FacetTaskDraft(
                    title: "Pick up repaired bicycle", projectId: home.id,
                    dueDate: calendar.addingDays(-3)))
            var note = FacetTaskPatch()
            note.appendComment = CommentUpload(
                comment: TaskComment(
                    id: UUID().uuidString, body: "The workshop will call when the wheel arrives.",
                    created_at: calendar.instant.ISO8601Format(), file_name: "work-order.txt"),
                attachment_base64: Data("Wheel service requested.".utf8).base64EncodedString())
            localStore.updateTask(id: task.id, patch: note)
            let overdue = [
                "Replace water filter", "Rotate houseplants", "Return library books",
                "Wash air purifier filter", "Sharpen kitchen knives", "Clean bike chain",
                "Water balcony herbs", "Refill bird feeder", "Check smoke alarms",
            ]
            for (index, title) in overdue.enumerated() {
                localStore.addTask(
                    FacetTaskDraft(
                        title: title, projectId: home.id,
                        dueDate: calendar.addingDays(-2),
                        recurrenceRule: index.isMultiple(of: 2) ? "FREQ=MONTHLY" : nil))
            }
            let today = [
                "Pick up coffee", "Buy pears", "Get sourdough", "Restock oats", "Buy spinach",
                "Check tea supplies", "Pick up lentils", "Add lemons", "Find fresh basil",
                "Buy eggs",
                "Order cat food", "Plan dinners", "Mail postcard", "Book haircut",
                "Collect dry cleaning",
                "Sort recycling", "Charge camera", "Water seedlings", "Order printer paper",
                "Send invitation",
                "Book campsite", "Measure kitchen shelf", "Choose a novel", "Return parcel",
                "Pack lunch",
            ]
            for (index, title) in today.enumerated() {
                localStore.addTask(
                    FacetTaskDraft(
                        title: title, projectId: index < 10 ? groceries.id : home.id,
                        dueDate: calendar.today))
            }
        }
    }
#endif
