import Foundation

/// Evaluates Todoist-style filter query strings (`Protocol.Filter.query`) against local tasks.
public enum FacetFilterQueryEvaluator {
    private static let trimChars = CharacterSet.whitespacesAndNewlines.union(
        CharacterSet(charactersIn: "()")
    )

    public static func filterTasks(
        _ tasks: [Task],
        query: String,
        projects: [Project],
        sections: [Section],
        labels: [Label],
        calendar: ViewerCalendar = ViewerCalendar()
    ) -> [Task] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return tasks.filter { !$0.is_deleted && !$0.completed }
        }
        let context = Context(
            projectsByID: Dictionary(uniqueKeysWithValues: projects.map { ($0.id, $0) }),
            sectionsByID: Dictionary(uniqueKeysWithValues: sections.map { ($0.id, $0) }),
            labelsByID: Dictionary(uniqueKeysWithValues: labels.map { ($0.id, $0) }),
            calendar: calendar
        )
        let mentionsCompleted = trimmed.lowercased().contains("completed")
        let unionBranches = trimmed.split(separator: "|").map { String($0) }

        return tasks.filter { task in
            guard !task.is_deleted else { return false }
            if !mentionsCompleted && task.completed { return false }
            return unionBranches.contains { branch in
                matchesConjunction(task: task, branch: branch, context: context)
            }
        }
    }

    private struct Context {
        let projectsByID: [String: Project]
        let sectionsByID: [String: Section]
        let labelsByID: [String: Label]
        let calendar: ViewerCalendar
    }

    private enum AtomMatch {
        case matched
        case unmatched
        case unhandled

        static func from(_ flag: Bool) -> Self {
            flag ? .matched : .unmatched
        }
    }

    private static func matchesConjunction(task: Task, branch: String, context: Context) -> Bool {
        let unwrappedBranch = branch.trimmingCharacters(in: trimChars)
        let rawTerms: [String]
        if unwrappedBranch.contains("&") {
            rawTerms = unwrappedBranch.split(separator: "&").map {
                $0.trimmingCharacters(in: trimChars)
            }
        } else {
            rawTerms = tokenizeTerms(unwrappedBranch)
        }
        for rawTerm in rawTerms where !rawTerm.isEmpty {
            let negated = rawTerm.hasPrefix("!")
            let core =
                negated
                ? String(rawTerm.dropFirst()).trimmingCharacters(in: trimChars)
                : rawTerm.trimmingCharacters(in: trimChars)
            let matched = matchesAtom(task: task, atom: core, context: context)
            if negated ? matched : !matched {
                return false
            }
        }
        return true
    }

    private static func tokenizeTerms(_ branch: String) -> [String] {
        let normalized = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = normalized.lowercased()
        let multiWordKeywords = ["no date", "7 days", "next 7 days"]
        if multiWordKeywords.contains(lower)
            || lower.hasPrefix("due before:")
            || lower.hasPrefix("due after:")
        {
            return [normalized]
        }
        return normalized.split(whereSeparator: \.isWhitespace).map(String.init)
    }

    private static func matchesAtom(task: Task, atom: String, context: Context) -> Bool {
        let lower = atom.lowercased()
        let dueCivil = context.calendar.effectiveCivilDay(
            dueDate: task.due_date,
            dueDatetime: task.due_datetime
        )
        let dateMatch = matchesDateAtom(
            lower: lower, dueCivil: dueCivil, calendar: context.calendar)
        if dateMatch != .unhandled {
            return dateMatch == .matched
        }
        let flagMatch = matchesFlagOrPriority(lower: lower, task: task)
        if flagMatch != .unhandled {
            return flagMatch == .matched
        }
        let prefixMatch = matchesPrefixedTaxonomy(atom: atom, task: task, context: context)
        if prefixMatch != .unhandled {
            return prefixMatch == .matched
        }
        return task.title.localizedCaseInsensitiveContains(atom)
            || task.description.localizedCaseInsensitiveContains(atom)
    }

    private static func matchesFlagOrPriority(lower: String, task: Task) -> AtomMatch {
        if lower == "recurring" { return .from(task.is_recurring) }
        if lower == "completed" { return .from(task.completed) }
        let priorityByToken: [String: Priority] = ["p1": .p1, "p2": .p2, "p3": .p3, "p4": .p4]
        if let wanted = priorityByToken[lower] {
            return .from(task.priority == wanted)
        }
        return .unhandled
    }

    private static func matchesPrefixedTaxonomy(
        atom: String,
        task: Task,
        context: Context
    ) -> AtomMatch {
        if atom.hasPrefix("#") {
            let wanted = String(atom.dropFirst()).lowercased()
            let projectName = context.projectsByID[task.project_id]?.name.lowercased() ?? ""
            return .from(projectName == wanted || projectName.contains(wanted))
        }
        if atom.hasPrefix("@") {
            let wanted = String(atom.dropFirst()).lowercased()
            return .from(
                task.label_ids.contains { labelID in
                    context.labelsByID[labelID]?.name.lowercased() == wanted
                }
            )
        }
        if atom.hasPrefix("/") {
            let wanted = String(atom.dropFirst()).lowercased()
            guard let sectionID = task.section_id else { return .unmatched }
            let sectionName = context.sectionsByID[sectionID]?.name.lowercased() ?? ""
            return .from(sectionName == wanted || sectionName.contains(wanted))
        }
        return .unhandled
    }

    private static func matchesDateAtom(
        lower: String,
        dueCivil: String?,
        calendar: ViewerCalendar
    ) -> AtomMatch {
        let named = matchesNamedDateAtom(lower: lower, dueCivil: dueCivil, calendar: calendar)
        if named != .unhandled { return named }
        return matchesRangeDateAtom(lower: lower, dueCivil: dueCivil, calendar: calendar)
    }

    private static func matchesNamedDateAtom(
        lower: String,
        dueCivil: String?,
        calendar: ViewerCalendar
    ) -> AtomMatch {
        if lower == "today" {
            return .from(dueCivil == calendar.today)
        }
        if lower == "nodate" || lower == "no date" {
            return .from(dueCivil == nil)
        }
        if lower == "overdue" {
            guard let dueCivil else { return .unmatched }
            return .from(dueCivil < calendar.today)
        }
        if lower == "upcoming" {
            guard let dueCivil else { return .unmatched }
            return .from(dueCivil >= calendar.today)
        }
        return .unhandled
    }

    private static func matchesRangeDateAtom(
        lower: String,
        dueCivil: String?,
        calendar: ViewerCalendar
    ) -> AtomMatch {
        if lower == "7 days" || lower == "next 7 days" {
            guard let dueCivil else { return .unmatched }
            let end = calendar.addingDays(7)
            return .from(dueCivil >= calendar.today && dueCivil <= end)
        }
        if lower.hasPrefix("due before:") {
            let limit = String(lower.dropFirst("due before:".count))
                .trimmingCharacters(in: .whitespaces)
            guard let dueCivil else { return .unmatched }
            return .from(dueCivil < limit)
        }
        if lower.hasPrefix("due after:") {
            let floorDate = String(lower.dropFirst("due after:".count))
                .trimmingCharacters(in: .whitespaces)
            guard let dueCivil else { return .unmatched }
            return .from(dueCivil > floorDate)
        }
        return .unhandled
    }
}
