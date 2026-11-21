import Foundation

extension FacetLocalStore {
    internal static func completedState(
        for task: Task,
        at completionDate: Date,
        nowISO: String
    ) -> CompletionOutcome {
        guard task.is_recurring, let rule = task.recurrence_rule, !rule.isEmpty else {
            return CompletionOutcome(
                updatedTask: task.setting(completed: true, completedAt: nowISO, updatedAt: nowISO),
                advanced: false,
                ended: false
            )
        }
        let next = FacetRecurrenceCodec.nextOccurrence(
            rule: rule,
            dueDate: task.due_date,
            dueDatetime: task.due_datetime,
            referenceDate: completionDate,
            completedAt: completionDate,
            timeZone: task.due_timezone.flatMap(TimeZone.init(identifier:)) ?? .gmt,
            basis: task.recurrence_basis ?? .scheduled
        )
        switch next {
        case .ended:
            return CompletionOutcome(
                updatedTask: task.setting(completed: true, completedAt: nowISO, updatedAt: nowISO),
                advanced: false,
                ended: true
            )
        case .advanced(let nextDate, let updatedRule):
            let advancedTask = buildAdvancedRecurringTask(
                from: task,
                nextDate: nextDate,
                updatedRule: updatedRule,
                nowISO: nowISO
            )
            return CompletionOutcome(updatedTask: advancedTask, advanced: true, ended: false)
        }
    }

    private static func buildAdvancedRecurringTask(
        from task: Task,
        nextDate: Date,
        updatedRule: String,
        nowISO: String
    ) -> Task {
        let zone =
            task.due_datetime == nil
            ? .gmt : task.due_timezone.flatMap(TimeZone.init(identifier:)) ?? .gmt
        let nextCivil = ViewerCalendar.civilDateString(for: nextDate, timeZone: zone)
        let hasDatetime = task.due_datetime.map { !$0.isEmpty } ?? false
        let hasDate = task.due_date.map { !$0.isEmpty } ?? false
        let nextDueDatetime = hasDatetime ? ISO8601DateFormatter().string(from: nextDate) : nil
        let nextDueDate = (!hasDatetime || hasDate) ? nextCivil : nil
        return Task(
            id: task.id,
            user_id: task.user_id,
            project_id: task.project_id,
            section_id: task.section_id,
            parent_id: task.parent_id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            child_order: task.child_order,
            due_date: nextDueDate,
            due_datetime: nextDueDatetime,
            due_timezone: task.due_timezone,
            due_string: task.due_string,
            is_recurring: true,
            recurrence_rule: updatedRule,
            label_ids: task.label_ids,
            completed: false,
            completed_at: nil,
            is_deleted: task.is_deleted,
            created_at: task.created_at,
            updated_at: nowISO,
            comments: task.comments,
            deadline: task.deadline,
            recurrence_basis: task.recurrence_basis
        )
    }
}
