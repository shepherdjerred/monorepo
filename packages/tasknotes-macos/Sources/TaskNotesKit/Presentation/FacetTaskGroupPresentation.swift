/// Join authoritative group membership without multiplying repeated note IDs.
public enum FacetTaskGroupPresentation {
    public static func tasks(_ page: [FacetTask], in group: FacetTaskGroup, groupBy: String?)
        -> [FacetTask]
    {
        var remaining = page
        return group.taskIds.compactMap { id in
            guard
                let index = remaining.firstIndex(where: { task in
                    guard task.id == id else { return false }
                    guard groupBy == "effectiveDate", let date = task.effectiveDate else {
                        return true
                    }
                    return String(date.prefix(10)) == group.key
                })
            else { return nil }
            return remaining.remove(at: index)
        }
    }
}
