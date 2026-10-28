import Foundation

func validateBinding(_ input: [String: Any]) throws { throw GuardFailure.binding }

func node(_ parent: Int?, _ kind: OfficialAccountNode.Kind, _ eligible: Bool = false)
    -> OfficialAccountNode
{
    OfficialAccountNode(parent: parent, kind: kind, eligible: eligible)
}

func require(_ value: Bool) throws {
    guard value else { throw GuardFailure.form }
}

func rejected(_ action: () throws -> Void) -> Bool {
    do {
        try action()
        return false
    } catch { return true }
}

do {
    let original = [
        node(nil, .other), node(0, .field, true), node(0, .login, true),
        node(0, .group), node(3, .group), node(4, .field, true),
        node(3, .login, true), node(3, .cancel, true),
    ]
    let expected = OfficialAccountSelection(container: 3, field: 5, login: 6, cancel: 7)
    try require(selectOfficialTOTPContainer(original) == expected)
    var nested = original
    nested[3] = node(8, .group)
    nested.append(node(0, .group))
    try require(selectOfficialTOTPContainer(nested) == expected)
    try require(selectOfficialTOTPContainer(original + [node(3, .field, true)]) == nil)
    let duplicate =
        original + [
            node(0, .group), node(8, .field, true), node(8, .login, true), node(8, .cancel, true),
        ]
    try require(rejected { _ = try selectOfficialTOTPContainer(duplicate) })
    for index in [5, 6, 7] {
        var ineligible = original
        ineligible[index] = node(original[index].parent, original[index].kind)
        try require(selectOfficialTOTPContainer(ineligible) == nil)
    }
    var malformed = original
    malformed[5] = node(100, .field, true)
    try require(rejected { _ = try selectOfficialTOTPContainer(malformed) })
    var cycle = original
    cycle[4] = node(5, .group)
    try require(rejected { _ = try selectOfficialTOTPContainer(cycle) })
    try require(uniqueOfficialAccountWindow([false, true]) == 1)
    try require(uniqueOfficialAccountWindow([false, false]) == nil)
    try require(rejected { _ = try uniqueOfficialAccountWindow([true, true]) })
    try require(
        rejected {
            _ = try selectOfficialTOTPContainer(Array(repeating: node(nil, .other), count: 2001))
        })
    FileHandle.standardOutput.write(
        Data(
            "{\"originalSwiftContainerSelector\":true,\"checked\":13,\"passed\":true,\"uiActions\":0}\n"
                .utf8))
} catch {
    FileHandle.standardOutput.write(
        Data("{\"originalSwiftContainerSelector\":true,\"passed\":false,\"uiActions\":0}\n".utf8))
    exit(3)
}
