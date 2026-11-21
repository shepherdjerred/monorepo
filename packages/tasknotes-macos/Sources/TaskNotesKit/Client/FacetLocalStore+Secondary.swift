import Foundation

extension FacetLocalStore {
    // MARK: - Projects

    @discardableResult
    public func addProject(
        name: String,
        color: String? = nil,
        parentId: String? = nil,
        isFavorite: Bool = false
    ) -> Project {
        let tempId = "tmp-\(UUID().uuidString.lowercased())"
        let now = Self.nowTimestamp()
        let order = (projects.map(\.child_order).max() ?? 0) + 1
        let project = Project(
            id: tempId,
            user_id: "",
            name: name,
            color: color ?? "charcoal",
            parent_id: parentId,
            child_order: order,
            is_inbox: false,
            is_favorite: isFavorite,
            is_archived: false,
            is_deleted: false,
            created_at: now,
            updated_at: now
        )
        projects.append(project)
        let args = ProjectAddArgs(
            name: name,
            color: color,
            parent_id: parentId,
            child_order: order,
            is_favorite: isFavorite
        )
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: tempId, command: .projectAdd(args))
        )
        schedulePersistence()
        return project
    }

    public func updateProject(
        id: String,
        name: String? = nil,
        color: String? = nil,
        isFavorite: FacetFieldPatch<Bool> = .unchanged,
        isArchived: FacetFieldPatch<Bool> = .unchanged
    ) {
        let now = Self.nowTimestamp()
        let wireFavorite =
            isFavorite == .set(true) ? true : (isFavorite == .set(false) ? false : nil)
        let wireArchived =
            isArchived == .set(true) ? true : (isArchived == .set(false) ? false : nil)
        if let index = projects.firstIndex(where: { $0.id == id }) {
            let current = projects[index]
            projects[index] = Project(
                id: current.id,
                user_id: current.user_id,
                name: name ?? current.name,
                color: color ?? current.color,
                parent_id: current.parent_id,
                child_order: current.child_order,
                is_inbox: current.is_inbox,
                is_favorite: wireFavorite ?? current.is_favorite,
                is_archived: wireArchived ?? current.is_archived,
                is_deleted: current.is_deleted,
                created_at: current.created_at,
                updated_at: now
            )
        }
        let args = ProjectUpdateArgs(
            id: id,
            name: name,
            color: color,
            parent_id: nil,
            child_order: nil,
            is_favorite: wireFavorite,
            is_archived: wireArchived
        )
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .projectUpdate(args))
        )
        schedulePersistence()
    }

    public func deleteProject(id: String) {
        projects.removeAll(where: { $0.id == id })
        sections.removeAll(where: { $0.project_id == id })
        tasks.removeAll(where: { $0.project_id == id })
        outbox.append(
            QueuedCommand(
                uuid: UUID().uuidString,
                temp_id: nil,
                command: .projectDelete(ProjectDeleteArgs(id: id))
            )
        )
        schedulePersistence()
    }

    // MARK: - Sections

    @discardableResult
    public func addSection(
        projectId: String,
        name: String,
        sectionOrder: Double? = nil
    ) -> Section {
        let tempId = "tmp-\(UUID().uuidString.lowercased())"
        let now = Self.nowTimestamp()
        let maxExisting = sections.filter { $0.project_id == projectId }.map(\.section_order).max()
        let order = sectionOrder ?? ((maxExisting ?? 0) + 1)
        let section = Section(
            id: tempId,
            project_id: projectId,
            user_id: "",
            name: name,
            section_order: order,
            is_archived: false,
            is_deleted: false,
            created_at: now,
            updated_at: now
        )
        sections.append(section)
        let args = SectionAddArgs(project_id: projectId, name: name, section_order: order)
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: tempId, command: .sectionAdd(args))
        )
        schedulePersistence()
        return section
    }

    public func updateSection(
        id: String,
        name: String? = nil,
        sectionOrder: Double? = nil,
        isArchived: FacetFieldPatch<Bool> = .unchanged
    ) {
        let now = Self.nowTimestamp()
        let wireArchived =
            isArchived == .set(true) ? true : (isArchived == .set(false) ? false : nil)
        if let index = sections.firstIndex(where: { $0.id == id }) {
            let current = sections[index]
            sections[index] = Section(
                id: current.id,
                project_id: current.project_id,
                user_id: current.user_id,
                name: name ?? current.name,
                section_order: sectionOrder ?? current.section_order,
                is_archived: wireArchived ?? current.is_archived,
                is_deleted: current.is_deleted,
                created_at: current.created_at,
                updated_at: now
            )
        }
        let args = SectionUpdateArgs(
            id: id,
            name: name,
            section_order: sectionOrder,
            is_archived: wireArchived
        )
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .sectionUpdate(args))
        )
        schedulePersistence()
    }

    public func deleteSection(id: String) {
        let now = Self.nowTimestamp()
        sections.removeAll(where: { $0.id == id })
        for index in tasks.indices where tasks[index].section_id == id {
            tasks[index] = tasks[index].applying(
                patch: FacetTaskPatch(sectionId: .clear),
                updatedAt: now
            )
        }
        outbox.append(
            QueuedCommand(
                uuid: UUID().uuidString,
                temp_id: nil,
                command: .sectionDelete(SectionDeleteArgs(id: id))
            )
        )
        schedulePersistence()
    }

    // MARK: - Labels

    @discardableResult
    public func addLabel(name: String, color: String? = nil, isFavorite: Bool = false) -> Label {
        let tempId = "tmp-\(UUID().uuidString.lowercased())"
        let order = (labels.map(\.item_order).max() ?? 0) + 1
        let label = Label(
            id: tempId,
            user_id: "",
            name: name,
            color: color ?? "charcoal",
            item_order: order,
            is_favorite: isFavorite,
            is_deleted: false
        )
        labels.append(label)
        let args = LabelAddArgs(
            name: name,
            color: color,
            item_order: order,
            is_favorite: isFavorite
        )
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: tempId, command: .labelAdd(args))
        )
        schedulePersistence()
        return label
    }

    public func updateLabel(
        id: String,
        name: String? = nil,
        color: String? = nil,
        isFavorite: FacetFieldPatch<Bool> = .unchanged
    ) {
        let wireFavorite =
            isFavorite == .set(true) ? true : (isFavorite == .set(false) ? false : nil)
        if let index = labels.firstIndex(where: { $0.id == id }) {
            let current = labels[index]
            labels[index] = Label(
                id: current.id,
                user_id: current.user_id,
                name: name ?? current.name,
                color: color ?? current.color,
                item_order: current.item_order,
                is_favorite: wireFavorite ?? current.is_favorite,
                is_deleted: current.is_deleted
            )
        }
        let args = LabelUpdateArgs(
            id: id,
            name: name,
            color: color,
            item_order: nil,
            is_favorite: wireFavorite
        )
        outbox.append(
            QueuedCommand(uuid: UUID().uuidString, temp_id: nil, command: .labelUpdate(args))
        )
        schedulePersistence()
    }

    public func deleteLabel(id: String) {
        let now = Self.nowTimestamp()
        labels.removeAll(where: { $0.id == id })
        for index in tasks.indices where tasks[index].label_ids.contains(id) {
            let filtered = tasks[index].label_ids.filter { $0 != id }
            tasks[index] = tasks[index].applying(
                patch: FacetTaskPatch(labelIds: .set(filtered)),
                updatedAt: now
            )
        }
        outbox.append(
            QueuedCommand(
                uuid: UUID().uuidString,
                temp_id: nil,
                command: .labelDelete(LabelDeleteArgs(id: id))
            )
        )
        schedulePersistence()
    }
}
