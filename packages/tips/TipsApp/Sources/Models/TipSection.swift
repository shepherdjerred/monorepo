/// A section within a tip file, corresponding to an h2 heading.
struct TipSection: Identifiable, Sendable {
    let id: String
    let heading: String
    let items: [TipItem]
}
