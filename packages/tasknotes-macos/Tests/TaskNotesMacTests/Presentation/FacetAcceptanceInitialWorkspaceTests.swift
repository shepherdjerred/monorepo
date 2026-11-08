#if DEBUG
    import Testing

    @testable import TaskNotesKit
    @testable import TaskNotesMac

    @Suite("Acceptance initial workspace lifecycle") @MainActor
    struct FacetAcceptanceInitialWorkspaceTests {
        @Test(arguments: [true, false])
        func bothEventOrdersRequestExactlyOnce(restorationFirst: Bool) throws {
            let policy = FacetAcceptanceInitialWorkspace()
            var inspections = 0
            var requests = 0
            let first: FacetAcceptanceInitialWorkspace.Event =
                restorationFirst ? .restorationFinished : .launchFinished
            let second: FacetAcceptanceInitialWorkspace.Event =
                restorationFirst ? .launchFinished : .restorationFinished
            func receive(_ event: FacetAcceptanceInitialWorkspace.Event) throws {
                try policy.receive(
                    event,
                    hasWindows: {
                        inspections += 1
                        return false
                    },
                    requestWindow: {
                        requests += 1
                        return true
                    })
            }
            try receive(first)
            try receive(first)
            #expect(inspections == 0)
            #expect(requests == 0)
            try receive(second)
            try receive(second)
            try receive(first)
            #expect(inspections == 1)
            #expect(requests == 1)
        }

        @Test(arguments: [1, 22])
        func existingWindowsNeverCauseAnotherRequest(count: Int) throws {
            let policy = FacetAcceptanceInitialWorkspace()
            try policy.receive(
                .restorationFinished, hasWindows: { count > 0 },
                requestWindow: {
                    Issue.record("No request may precede launch completion.")
                    return true
                })
            try policy.receive(
                .launchFinished, hasWindows: { count > 0 },
                requestWindow: {
                    Issue.record("Existing windows must not be multiplied.")
                    return true
                })
            // Closing existing windows later must not turn duplicate events into a new request.
            try policy.receive(
                .launchFinished, hasWindows: { false },
                requestWindow: {
                    Issue.record("The initial lifecycle decision must remain settled.")
                    return true
                })
        }

        @Test(arguments: [true, false])
        func unsupportedOrFailedRequestCannotRetry(supported: Bool) throws {
            let policy = FacetAcceptanceInitialWorkspace()
            var requests = 0
            let result = supported ? false : nil
            try policy.receive(
                .launchFinished, hasWindows: { false }, requestWindow: { result == true })
            #expect(throws: FacetAcceptanceError.self) {
                try policy.receive(
                    .restorationFinished, hasWindows: { false },
                    requestWindow: {
                        requests += 1
                        return result == true
                    })
            }
            try policy.receive(
                .restorationFinished, hasWindows: { false },
                requestWindow: {
                    requests += 1
                    return true
                })
            #expect(requests == 1)
        }

        @Test func synchronousDelegateReentryCannotCreateTwice() throws {
            let policy = FacetAcceptanceInitialWorkspace()
            var requests = 0
            try policy.receive(.launchFinished, hasWindows: { false }, requestWindow: { true })
            try policy.receive(
                .restorationFinished, hasWindows: { false },
                requestWindow: {
                    requests += 1
                    do {
                        try policy.receive(
                            .launchFinished, hasWindows: { false },
                            requestWindow: {
                                requests += 1
                                return true
                            })
                    } catch {
                        Issue.record("A settled duplicate event must not fail.")
                    }
                    return true
                })
            #expect(requests == 1)
        }
    }
#endif
