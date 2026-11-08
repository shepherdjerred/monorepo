import Foundation
import Testing

@testable import TaskNotesFacetUI

@Suite("Mobile widget route ownership") @MainActor
struct FacetMobileNavigationTests {
    @Test func anAdmittedTodayRequestSelectsTheActualTab() async {
        let navigation = FacetMobileNavigation(route: "upcoming")
        #expect(await navigation.requestToday(ownsOwner: { true }, admitNavigation: { true }))
        #expect(navigation.route == "today")
    }

    @Test func aPendingDraftCanVetoTheWidgetRoute() async {
        let navigation = FacetMobileNavigation(route: "browse")
        #expect(!(await navigation.requestToday(ownsOwner: { true }, admitNavigation: { false })))
        #expect(navigation.route == "browse")
    }

    @Test func aVaultSwitchDuringAdmissionCannotRedirectTheNewVault() async {
        let navigation = FacetMobileNavigation(route: "inbox")
        var profile = "original"
        #expect(
            !(await navigation.requestToday(
                ownsOwner: { profile == "original" },
                admitNavigation: {
                    profile = "another"
                    return true
                })))
        #expect(navigation.route == "inbox")
    }

    @Test func aNewerUserTabChoiceWinsOverAnAwaitedRequest() async {
        let navigation = FacetMobileNavigation(route: "inbox")
        #expect(
            !(await navigation.requestToday(
                ownsOwner: { true },
                admitNavigation: {
                    navigation.route = "upcoming"
                    return true
                })))
        #expect(navigation.route == "upcoming")
    }

    @Test func repeatedIdenticalWidgetURLsRemainDistinctEvents() throws {
        let store = FacetStore()
        let url = try #require(URL(string: "tasknotes://today"))
        store.handleURL(url)
        let first = try #require(store.navigationRequestID)
        store.handleURL(url)
        let second = try #require(store.navigationRequestID)
        #expect(first != second)
    }
}
