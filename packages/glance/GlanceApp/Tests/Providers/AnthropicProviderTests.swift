import Foundation
@testable import GlanceApp
import Testing

struct AnthropicProviderTests {
    @Test
    func `normal cost returns ok`() throws {
        let snapshot = try AnthropicProvider.parse(
            costData: AnthropicFixtures.costResponseJSON,
            usageData: AnthropicFixtures.usageResponseJSON,
        )
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary.contains("2 models"))
    }

    @Test
    func `warning at50`() throws {
        let snapshot = try AnthropicProvider.parse(
            costData: AnthropicFixtures.highCostResponseJSON,
            usageData: AnthropicFixtures.usageResponseJSON,
        )
        #expect(snapshot.status == .warning)
    }

    @Test
    func `error at100`() throws {
        let snapshot = try AnthropicProvider.parse(
            costData: AnthropicFixtures.criticalCostResponseJSON,
            usageData: AnthropicFixtures.usageResponseJSON,
        )
        #expect(snapshot.status == .error)
    }

    @Test
    func `empty cost returns ok`() throws {
        let snapshot = try AnthropicProvider.parse(
            costData: AnthropicFixtures.emptyCostResponseJSON,
            usageData: AnthropicFixtures.emptyUsageResponseJSON,
        )
        #expect(snapshot.status == .ok)
    }

    @Test
    func `malformed cost throws`() {
        #expect(throws: (any Error).self) {
            try AnthropicProvider.parse(
                costData: Data("x".utf8),
                usageData: AnthropicFixtures.usageResponseJSON,
            )
        }
    }
}
