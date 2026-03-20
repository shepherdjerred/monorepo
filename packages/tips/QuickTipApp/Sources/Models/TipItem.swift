/// An individual tip within a section, parsed from a markdown list item.
struct TipItem: Identifiable {
    let id: String
    let text: String
    let shortcut: String?
}
