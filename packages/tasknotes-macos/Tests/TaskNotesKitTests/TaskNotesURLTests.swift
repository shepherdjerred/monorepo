import Foundation
internal import TaskNotesKit
import Testing

@Suite("tasknotes:// routing")
struct TaskNotesURLTests {
    /// Every destination must round-trip. Driving this off `allCases` rather
    /// than a literal list is what makes adding a destination without a working
    /// deep link impossible.
    @Test("every sidebar section round-trips through its URL", arguments: SidebarSection.allCases)
    func roundTrip(section: SidebarSection) throws {
        let link = TaskNotesURL.section(section)
        #expect(TaskNotesURL(link.url) == link)
    }

    @Test(
        "unhandled URLs are rejected rather than defaulted",
        arguments: [
            "https://sjer.red/today",  // wrong scheme
            "tasknotes://nowhere",  // unknown host
            "tasknotes:///today",  // path, not host
            "tasknotes:today",  // opaque
            "tasknotes://",  // no host at all
        ]
    )
    func rejectsUnknown(raw: String) throws {
        let url = try #require(URL(string: raw))
        #expect(TaskNotesURL(url) == nil)
    }

    /// macOS does not promise the case it hands over, so the parser lowercases.
    @Test("host matching is case-insensitive")
    func caseInsensitiveHost() throws {
        let url = try #require(URL(string: "TASKNOTES://Upcoming"))
        #expect(TaskNotesURL(url) == .section(.upcoming))
    }

    /// The identifiers are what a UI test looks elements up by, so a collision
    /// would silently make two assertions target the same element.
    @Test("accessibility identifiers are unique per section")
    func identifiersAreUnique() throws {
        let identifiers = SidebarSection.allCases.flatMap {
            [AccessibilityIdentifier.sidebarItem($0), AccessibilityIdentifier.detail($0)]
        }
        #expect(Set(identifiers).count == identifiers.count)
    }
}
