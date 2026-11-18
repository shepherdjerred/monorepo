internal import Foundation

extension Task {
    func setting(completed: Bool, completedAt: String?, updatedAt: String) -> Task {
        Task(
            id: id,
            user_id: user_id,
            project_id: project_id,
            section_id: section_id,
            parent_id: parent_id,
            title: title,
            description: description,
            priority: priority,
            child_order: child_order,
            due_date: due_date,
            due_datetime: due_datetime,
            due_timezone: due_timezone,
            due_string: due_string,
            is_recurring: is_recurring,
            recurrence_rule: recurrence_rule,
            label_ids: label_ids,
            completed: completed,
            completed_at: completedAt,
            is_deleted: is_deleted,
            created_at: created_at,
            updated_at: updatedAt
        )
    }

    func remapping(ids mapping: [String: String]) -> Task {
        let mappedId = mapping[id] ?? id
        let mappedProject = mapping[project_id] ?? project_id
        let mappedSection = section_id.flatMap { mapping[$0] ?? $0 }
        let mappedParent = parent_id.flatMap { mapping[$0] ?? $0 }
        let mappedLabels = label_ids.map { mapping[$0] ?? $0 }
        guard
            mappedId != id
                || mappedProject != project_id
                || mappedSection != section_id
                || mappedParent != parent_id
                || mappedLabels != label_ids
        else {
            return self
        }
        return Task(
            id: mappedId,
            user_id: user_id,
            project_id: mappedProject,
            section_id: mappedSection,
            parent_id: mappedParent,
            title: title,
            description: description,
            priority: priority,
            child_order: child_order,
            due_date: due_date,
            due_datetime: due_datetime,
            due_timezone: due_timezone,
            due_string: due_string,
            is_recurring: is_recurring,
            recurrence_rule: recurrence_rule,
            label_ids: mappedLabels,
            completed: completed,
            completed_at: completed_at,
            is_deleted: is_deleted,
            created_at: created_at,
            updated_at: updated_at
        )
    }
}

extension Project {
    func remapping(ids mapping: [String: String]) -> Project {
        let mappedId = mapping[id] ?? id
        let mappedParent = parent_id.flatMap { mapping[$0] ?? $0 }
        guard mappedId != id || mappedParent != parent_id else {
            return self
        }
        return Project(
            id: mappedId,
            user_id: user_id,
            name: name,
            color: color,
            parent_id: mappedParent,
            child_order: child_order,
            is_inbox: is_inbox,
            is_favorite: is_favorite,
            is_archived: is_archived,
            is_deleted: is_deleted,
            created_at: created_at,
            updated_at: updated_at
        )
    }
}
