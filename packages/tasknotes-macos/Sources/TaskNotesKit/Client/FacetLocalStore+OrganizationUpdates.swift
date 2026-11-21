extension FacetLocalStore {
    internal func applyProjectUpdate(_ args: ProjectUpdateArgs, now: String) {
        if let index = projects.firstIndex(where: { $0.id == args.id }) {
            let current = projects[index]
            projects[index] = Project(
                id: current.id,
                user_id: current.user_id,
                name: args.name ?? current.name,
                color: args.color ?? current.color,
                parent_id: args.parent_id.map { $0.isEmpty ? nil : $0 } ?? current.parent_id,
                child_order: args.child_order ?? current.child_order,
                is_inbox: current.is_inbox,
                is_favorite: args.is_favorite ?? current.is_favorite,
                is_archived: args.is_archived ?? current.is_archived,
                is_deleted: current.is_deleted,
                created_at: current.created_at,
                updated_at: now
            )
        }
    }

    internal func applyLabelUpdate(_ args: LabelUpdateArgs) {
        if let index = labels.firstIndex(where: { $0.id == args.id }) {
            let current = labels[index]
            labels[index] = Label(
                id: current.id,
                user_id: current.user_id,
                name: args.name ?? current.name,
                color: args.color ?? current.color,
                item_order: args.item_order ?? current.item_order,
                is_favorite: args.is_favorite ?? current.is_favorite,
                is_deleted: current.is_deleted
            )
        }
    }

    internal func applyFilterUpdate(_ args: FilterUpdateArgs) {
        if let index = filters.firstIndex(where: { $0.id == args.id }) {
            let current = filters[index]
            filters[index] = Filter(
                id: current.id,
                user_id: current.user_id,
                name: args.name ?? current.name,
                query: args.query ?? current.query,
                color: args.color ?? current.color,
                item_order: args.item_order ?? current.item_order,
                is_favorite: args.is_favorite ?? current.is_favorite,
                is_deleted: current.is_deleted
            )
        }
    }
}
