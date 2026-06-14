import Foundation

enum AnthropicFixtures {
    static let costResponseJSON = Data("""
    {
        "data": [
            {
                "costs": [
                    {"amount": "12.50"},
                    {"amount": "8.25"}
                ]
            },
            {
                "costs": [
                    {"amount": "3.00"}
                ]
            }
        ]
    }
    """.utf8)

    static let usageResponseJSON = Data("""
    {
        "data": [
            {
                "usage": [
                    {
                        "model": "claude-sonnet-4-20250514",
                        "input_tokens": 50000,
                        "output_tokens": 10000,
                        "cache_creation_input_tokens": 5000,
                        "cache_read_input_tokens": 2000
                    },
                    {
                        "model": "claude-haiku-4-20250514",
                        "input_tokens": 100000,
                        "output_tokens": 20000,
                        "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 0
                    }
                ]
            }
        ]
    }
    """.utf8)

    static let highCostResponseJSON = Data("""
    {
        "data": [
            {
                "costs": [
                    {"amount": "55.00"}
                ]
            }
        ]
    }
    """.utf8)

    static let criticalCostResponseJSON = Data("""
    {
        "data": [
            {
                "costs": [
                    {"amount": "120.00"}
                ]
            }
        ]
    }
    """.utf8)

    static let emptyCostResponseJSON = Data("""
    {"data": []}
    """.utf8)

    static let emptyUsageResponseJSON = Data("""
    {"data": []}
    """.utf8)
}
