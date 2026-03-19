import Foundation
@testable import GlanceApp
import Testing

struct OpenAIProviderTests {
    @Test
    func `normal cost returns ok`() throws {
        let snapshot = try OpenAIProvider.parse(
            costData: OpenAIFixtures.costResponseJSON,
            usageData: OpenAIFixtures.usageResponseJSON,
        )
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary.contains("2 models"))
    }

    @Test
    func `warning at50`() throws {
        let snapshot = try OpenAIProvider.parse(
            costData: OpenAIFixtures.highCostResponseJSON,
            usageData: OpenAIFixtures.usageResponseJSON,
        )
        #expect(snapshot.status == .warning)
    }

    @Test
    func `error at100`() throws {
        let snapshot = try OpenAIProvider.parse(
            costData: OpenAIFixtures.criticalCostResponseJSON,
            usageData: OpenAIFixtures.usageResponseJSON,
        )
        #expect(snapshot.status == .error)
    }

    @Test
    func `empty cost returns ok`() throws {
        let snapshot = try OpenAIProvider.parse(
            costData: OpenAIFixtures.emptyCostResponseJSON,
            usageData: OpenAIFixtures.emptyUsageResponseJSON,
        )
        #expect(snapshot.status == .ok)
    }

    @Test
    func `malformed cost throws`() {
        #expect(throws: (any Error).self) {
            try OpenAIProvider.parse(
                costData: Data("x".utf8),
                usageData: OpenAIFixtures.usageResponseJSON,
            )
        }
    }
}
