import Foundation
import Testing

@testable import TaskNotesFacetUI
@testable import TaskNotesKit

@Suite("Window queries and native action admission") @MainActor
struct FacetWindowStateTests {
    @Test func multiValueSavedViewFiltersRemainUntilExplicitlyChanged() async throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let value: FacetValue = .object([
            "id": .string("multiple"), "revision": .string(String(repeating: "a", count: 64)),
            "view": .object([
                "query": .object([
                    "scope": .string("all"),
                    "statuses": .array([.string("open"), .string("doing")]),
                    "priorities": .array([.string("normal"), .string("high")]), "completed": .null,
                ])
            ]),
        ])
        let view = try FacetFeatureProjection.decode(FacetSavedView.self, from: value)
        let window = FacetWindowState(store: store)
        await window.apply(view, store: store)
        let query = try #require(window.query().object?.fields)
        #expect(query["statuses"] == .array([.string("open"), .string("doing")]))
        #expect(query["priorities"] == .array([.string("normal"), .string("high")]))
        #expect(query["completed"] == .null)
        window.status = "done"
        #expect(try window.query().object?.fields["statuses"] == .array([.string("done")]))
        #expect(try window.query().object?.fields["priorities"] == query["priorities"])
        window.status = ""
        #expect(try window.query().object?.fields["statuses"] == nil)
        window.showCompleted = false
        #expect(try window.query().object?.fields["completed"] == .bool(false))
    }

    @Test func independentWindowReadCannotRetireAnAwaitedMutation() async throws {
        let store = try FacetSurfaceFixtures.store(.populated)
        let snapshot = try #require(store.snapshot)
        let originalRequest = store.requestGeneration
        let pause = Suspension()
        var published = false
        let receipt = try FacetStoreOwnershipTests().receipt()
        let mutation = _Concurrency.Task {
            await store.runSavedAction(
                action: ("action", snapshot.profileId), ownsEngine: { true },
                apply: {
                    await pause.pause()
                    return receipt
                }, cleanup: {}, reload: { published = true })
        }
        await pause.waitUntilEntered()
        let first = FacetWindowState(store: store)
        let second = FacetWindowState(store: store)
        first.search = "release"
        await first.load(profileID: snapshot.profileId, query: try first.query()) { snapshot }
        second.scope = "upcoming"
        await second.load(profileID: snapshot.profileId, query: try second.query()) { snapshot }
        #expect(store.requestGeneration == originalRequest)
        #expect(first.displayedQuery != second.displayedQuery)
        pause.resume()
        #expect(await mutation.value)
        #expect(published)
    }

    @Test func orderedRowsContinueAfterFailureAndKeepCapturedEnvelope() async {
        let queue = FacetActionCoordinator()
        let pause = Suspension()
        var order: [String] = []
        var selected = "A"
        let first = _Concurrency.Task {
            await queue.submit {
                order.append("first")
                await pause.pause()
                return true
            }
        }
        await pause.waitUntilEntered()
        let capturedProfile = selected
        let capturedPath = "Tasks/Second.md"
        let second = _Concurrency.Task {
            await queue.submit {
                #expect(capturedPath == "Tasks/Second.md")
                order.append("second")
                return selected == capturedProfile
            }
        }
        await _Concurrency.Task.yield()
        selected = "B"
        let third = _Concurrency.Task {
            await queue.submit {
                order.append("third")
                return true
            }
        }
        await _Concurrency.Task.yield()
        pause.resume()
        #expect(await first.value)
        #expect(!(await second.value))
        #expect(await third.value)
        #expect(order == ["first", "second", "third"])
    }

    @Test func anotherWindowsFailedDraftVetoesProfileAndTermination() async {
        let coordinator = FacetDraftCoordinator()
        let store = FacetStore()
        let first = UUID()
        let second = UUID()
        var visits = Set<String>()
        coordinator.register(first, owner: store, profileID: "A") {
            visits.insert("A")
            return true
        }
        coordinator.register(second, owner: store, profileID: "A") {
            visits.insert("B")
            return false
        }
        #expect(!(await coordinator.flush(owner: store)))
        #expect(visits.contains("B"))
        #expect(!(await coordinator.flushAll()))
        coordinator.unregister(second)
        #expect(await coordinator.flush(owner: store))
        coordinator.unregister(first)
    }

    @Test func occurrenceRowIdentityIncludesExplicitDay() {
        let first = FacetTaskRowID(taskID: "Tasks/Daily.md", occurrenceDate: "2026-10-08")
        let second = FacetTaskRowID(taskID: "Tasks/Daily.md", occurrenceDate: "2026-10-09")
        #expect(first != second)
    }

    @Test func typingDuringSuspendedFlushVetoesLifecycleInvalidation() async {
        let coordinator = FacetDraftCoordinator()
        let store = FacetStore()
        let pause = Suspension()
        var dirty = true
        var switched = false
        coordinator.register(
            UUID(), owner: store, profileID: "A", isDirty: { dirty },
            flush: {
                dirty = false
                await pause.pause()
                return true
            })
        let transition = _Concurrency.Task {
            await coordinator.transition(owner: store) { switched = true }
        }
        await pause.waitUntilEntered()
        #expect(coordinator.isTransitioning)
        // Even a programmatic buffer edit during suspension must survive.
        dirty = true
        pause.resume()
        #expect(!(await transition.value))
        #expect(!switched)
        #expect(dirty)
        #expect(!coordinator.isTransitioning)
    }

    @Test func newlyRegisteredWindowIsDrainedBeforeProfileTransition() async {
        let coordinator = FacetDraftCoordinator()
        let store = FacetStore()
        let pause = Suspension()
        var firstPass = true
        var secondVisited = false
        var switched = false
        coordinator.register(UUID(), owner: store, profileID: "A") {
            if firstPass {
                firstPass = false
                await pause.pause()
            }
            return true
        }
        let transition = _Concurrency.Task {
            await coordinator.transition(owner: store) { switched = true }
        }
        await pause.waitUntilEntered()
        coordinator.register(UUID(), owner: store, profileID: "A") {
            secondVisited = true
            return false
        }
        pause.resume()
        #expect(!(await transition.value))
        #expect(secondVisited)
        #expect(!switched)
    }

    @Test func configuredColorsPreserveCssAlphaAndUnsupportedValue() throws {
        #expect(FacetConfiguredColor(" #f008 ")?.alpha == 8.0 / 15.0)
        #expect(FacetConfiguredColor("#ff000080")?.alpha == 128.0 / 255.0)
        #expect(FacetConfiguredColor(" RED ") == FacetConfiguredColor("#ff0000"))
        #expect(FacetConfiguredColor("transparent")?.alpha == 0)
        #expect(FacetConfiguredColor("var(--urgent)") == nil)
        let config: FacetValue = .object([
            "priorities": .array([
                .object([
                    "value": .string("urgent-custom"), "label": .string("Needs review"),
                    "color": .string("var(--urgent)"), "weight": .integer(4),
                ])
            ])
        ])
        let choice = try #require(
            FacetConfiguredChoice.choices(in: config, key: "priorities").first)
        #expect(choice.value == "urgent-custom")
        #expect(choice.label == "Needs review")
        #expect(choice.color == "var(--urgent)")
        #expect(choice.colorDiagnostic != nil)
    }
}
