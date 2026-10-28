import ApplicationServices
import Foundation

struct OfficialAccountNode {
    enum Kind { case group, field, login, cancel, other }
    let parent: Int?
    let kind: Kind
    let eligible: Bool
}

struct OfficialAccountSelection: Equatable {
    let container: Int
    let field: Int
    let login: Int
    let cancel: Int
}

func uniqueOfficialAccountWindow(_ matches: [Bool]) throws -> Int? {
    let candidates = matches.indices.filter { matches[$0] }
    guard candidates.count <= 1 else { throw GuardFailure.form }
    return candidates.first
}

/// Select the nearest complete account group, keeping unrelated window fields outside its scope.
func selectOfficialTOTPContainer(_ nodes: [OfficialAccountNode]) throws -> OfficialAccountSelection?
{
    guard nodes.count <= 2000 else { throw GuardFailure.form }
    var children = [[Int]](repeating: [], count: nodes.count)
    for (index, node) in nodes.enumerated() {
        if let parent = node.parent {
            guard nodes.indices.contains(parent), parent != index else { throw GuardFailure.form }
            children[parent].append(index)
        }
    }
    var selections: [OfficialAccountSelection] = []
    for (index, node) in nodes.enumerated() where node.kind == .field && node.eligible {
        if let selection = try nearestOfficialAccountGroup(index, nodes: nodes, children: children)
        {
            selections.append(selection)
        }
    }
    guard selections.count <= 1 else { throw GuardFailure.form }
    return selections.first
}

private func nearestOfficialAccountGroup(
    _ field: Int, nodes: [OfficialAccountNode], children: [[Int]]
) throws -> OfficialAccountSelection? {
    var current: Int? = field
    var visited = Set<Int>()
    for _ in 0..<12 {
        guard let index = current else { return nil }
        guard visited.insert(index).inserted else { throw GuardFailure.form }
        if nodes[index].kind == .group,
            let selection = try completeOfficialAccountGroup(
                index, nodes: nodes, children: children)
        {
            return selection
        }
        current = nodes[index].parent
    }
    return nil
}

private func completeOfficialAccountGroup(
    _ container: Int, nodes: [OfficialAccountNode], children: [[Int]]
) throws -> OfficialAccountSelection? {
    var pending = [container]
    var visited = Set<Int>()
    var cursor = 0
    while cursor < pending.count {
        guard visited.insert(pending[cursor]).inserted, visited.count <= 2000 else {
            throw GuardFailure.form
        }
        pending += children[pending[cursor]]
        cursor += 1
    }
    let fields = pending.filter { nodes[$0].kind == .field }
    let login = pending.filter { nodes[$0].kind == .login }
    let cancel = pending.filter { nodes[$0].kind == .cancel }
    guard fields.count == 1, login.count == 1, cancel.count == 1,
        let field = fields.first, let loginButton = login.first, let cancelButton = cancel.first,
        nodes[field].eligible, nodes[loginButton].eligible, nodes[cancelButton].eligible
    else { return nil }
    return OfficialAccountSelection(
        container: container, field: field, login: loginButton, cancel: cancelButton)
}

struct OfficialTOTPForm {
    let container: AXUIElement
    let field: AXUIElement
    let login: AXUIElement
    let cancel: AXUIElement
}

func officialTOTPForm(_ window: AXUIElement) throws -> OfficialTOTPForm? {
    let elements = try descendants(window)
    let nodes = elements.map { element -> OfficialAccountNode in
        let kind = officialAccountKind(element)
        let rawParent = attribute(element, "AXParent")
        let parent = elements.firstIndex { sameElement(rawParent, $0) }
        let eligible =
            attribute(element, "AXEnabled") as? Bool == true
            && sameElement(attribute(element, "AXWindow"), window)
            && (kind != .field || attribute(element, "AXSubrole") as? String != "AXSecureTextField")
        return OfficialAccountNode(parent: parent, kind: kind, eligible: eligible)
    }
    guard let selection = try selectOfficialTOTPContainer(nodes) else { return nil }
    return OfficialTOTPForm(
        container: elements[selection.container], field: elements[selection.field],
        login: elements[selection.login], cancel: elements[selection.cancel])
}

private func officialAccountKind(_ element: AXUIElement) -> OfficialAccountNode.Kind {
    switch attribute(element, "AXRole") as? String {
    case "AXGroup": return .group
    case "AXTextField": return .field
    case "AXButton":
        switch attribute(element, "AXTitle") as? String {
        case "Log in": return .login
        case "Cancel": return .cancel
        case .some, .none: return .other
        }
    case .some, .none: return .other
    }
}
