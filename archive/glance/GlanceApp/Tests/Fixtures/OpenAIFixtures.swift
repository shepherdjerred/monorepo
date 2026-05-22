import Foundation

enum OpenAIFixtures {
    static let costResponseJSON = Data("""
    {
        "data": [
            {
                "results": [
                    {"amount": {"value": 15.50}},
                    {"amount": {"value": 4.25}}
                ]
            }
        ]
    }
    """.utf8)

    static let usageResponseJSON = Data("""
    {
        "data": [
            {
                "results": [
                    {
                        "model": "gpt-4o",
                        "input_tokens": 80000,
                        "output_tokens": 15000,
                        "num_model_requests": 200
                    },
                    {
                        "model": "gpt-4o-mini",
                        "input_tokens": 200000,
                        "output_tokens": 50000,
                        "num_model_requests": 500
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
                "results": [
                    {"amount": {"value": 60.00}}
                ]
            }
        ]
    }
    """.utf8)

    static let criticalCostResponseJSON = Data("""
    {
        "data": [
            {
                "results": [
                    {"amount": {"value": 150.00}}
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

    static let nullAmountCostJSON = Data("""
    {
        "data": [
            {
                "results": [
                    {"amount": null}
                ]
            }
        ]
    }
    """.utf8)
}
