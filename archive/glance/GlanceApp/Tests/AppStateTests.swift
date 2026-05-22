@testable import GlanceApp
import Testing

@MainActor
struct AppStateTests {
    @Test
    func `refresh populates snapshots from providers`() async {
        let providers: [any ServiceProvider] = [
            MockServiceProvider(id: "a", displayName: "Alpha", status: .ok, summary: "OK"),
            MockServiceProvider(id: "b", displayName: "Beta", status: .warning, summary: "Warn"),
        ]
        let state = AppState(providers: providers)

        await state.refreshNow()

        #expect(state.snapshots.count == 2)
        #expect(state.snapshots[0].displayName == "Alpha")
        #expect(state.snapshots[1].displayName == "Beta")
    }

    @Test
    func `overall health reflects worst status`() async {
        let providers: [any ServiceProvider] = [
            MockServiceProvider(id: "ok", displayName: "OK", status: .ok),
            MockServiceProvider(id: "warn", displayName: "Warn", status: .warning),
            MockServiceProvider(id: "err", displayName: "Error", status: .error),
        ]
        let state = AppState(providers: providers)

        await state.refreshNow()

        #expect(state.overallHealth == .error)
    }

    @Test
    func `all-ok services yield overall ok`() async {
        let providers: [any ServiceProvider] = [
            MockServiceProvider(id: "a", displayName: "A", status: .ok),
            MockServiceProvider(id: "b", displayName: "B", status: .ok),
        ]
        let state = AppState(providers: providers)

        await state.refreshNow()

        #expect(state.overallHealth == .ok)
    }

    @Test
    func `empty providers yield unknown health`() async {
        let state = AppState(providers: [])

        await state.refreshNow()

        #expect(state.overallHealth == .unknown)
        #expect(state.snapshots.isEmpty)
    }

    @Test
    func `lastRefresh is set after refresh`() async {
        let state = AppState(providers: [
            MockServiceProvider(id: "a", displayName: "A"),
        ])

        #expect(state.lastRefresh == nil)

        await state.refreshNow()

        #expect(state.lastRefresh != nil)
    }

    @Test
    func `snapshots sorted alphabetically by displayName`() async {
        let providers: [any ServiceProvider] = [
            MockServiceProvider(id: "z", displayName: "Zebra"),
            MockServiceProvider(id: "a", displayName: "Alpha"),
            MockServiceProvider(id: "m", displayName: "Middle"),
        ]
        let state = AppState(providers: providers)

        await state.refreshNow()

        #expect(state.snapshots.map(\.displayName) == ["Alpha", "Middle", "Zebra"])
    }

    @Test
    func `snapshot lookup by id`() async {
        let state = AppState(providers: [
            MockServiceProvider(id: "test", displayName: "Test"),
        ])

        await state.refreshNow()

        #expect(state.snapshot(for: "test")?.displayName == "Test")
        #expect(state.snapshot(for: "nonexistent") == nil)
    }

    @Test
    func `menu bar icon reflects overall health`() async {
        let state = AppState(providers: [
            MockServiceProvider(id: "err", displayName: "Error", status: .error),
        ])

        await state.refreshNow()

        #expect(state.menuBarIcon == "xmark.circle.fill")
    }
}
