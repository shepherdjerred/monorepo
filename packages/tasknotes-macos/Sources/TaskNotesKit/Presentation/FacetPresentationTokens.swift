public import Foundation

/// Native values validated against the shared language-neutral specification.
public struct FacetPresentationTokens: Decodable, Sendable {
    public let schemaVersion: UInt32
    public let colorRoles: [String]
    public let spacing: Spacing
    public let radii: Radii
    public let typography: Typography
    public let hitTargets: HitTargets
    public let motion: Motion
    public let desktop: Desktop
    public let mobile: Mobile

    public struct Spacing: Decodable, Sendable {
        public let xxs: Double
        public let xs: Double
        public let sm: Double
        public let md: Double
        public let lg: Double
        public let xl: Double
        public let xxl: Double
        public let xxxl: Double
    }

    public struct Radii: Decodable, Sendable {
        public let small: Double
        public let medium: Double
        public let large: Double
        public let capsule: Double
    }

    public struct Typography: Decodable, Sendable {
        public let title: FontRole
        public let heading: FontRole
        public let subheading: FontRole
        public let body: FontRole
        public let bodySmall: FontRole
        public let caption: FontRole
        public let label: FontRole
    }

    public struct FontRole: Decodable, Sendable {
        public let size: Double
        public let weight: Double
        public let lineHeight: Double
    }

    public struct HitTargets: Decodable, Sendable {
        public let desktop: Double
        public let mobile: Double
        public let android: Double
    }

    public struct Motion: Decodable, Sendable {
        public let milliseconds: Milliseconds
        public let checkboxSpring: CheckboxSpring
    }

    public struct Milliseconds: Decodable, Sendable {
        public let rowChange: Double
        public let hover: Double
        public let toastEnter: Double
        public let toastExit: Double
        public let fieldHint: Double
        public let checkboxFill: Double
    }

    public struct CheckboxSpring: Decodable, Sendable {
        public let peakScale: Double
        public let damping: Double
        public let stiffness: Double
    }

    public struct Desktop: Decodable, Sendable {
        public let sidebar: Column
        public let inspector: Column
        public let dateColumnMin: Double
        public let rowVerticalPadding: Double
    }

    public struct Column: Decodable, Sendable {
        public let min: Double
        public let ideal: Double
        public let max: Double
    }

    public struct Mobile: Decodable, Sendable {
        public let checkboxSize: Double
        public let rowVerticalPadding: Double
        public let detailDetents: [Double]
    }

    public static let shared: Self = {
        do { return try bundled() } catch {
            preconditionFailure("Facet presentation resources are invalid: \(error)")
        }
    }()

    public static func bundled() throws -> Self {
        guard
            let values = Bundle.module.url(
                forResource: "FacetPresentationTokens", withExtension: "json"),
            let schema = Bundle.module.url(
                forResource: "FacetPresentationSchema", withExtension: "json")
        else { throw FacetContractError.unsupportedResponse }
        return try decode(data: Data(contentsOf: values), schema: Data(contentsOf: schema))
    }

    public static func decode(data: Data, schema: Data) throws -> Self {
        try FacetSchema(data: schema).validate(FacetJSON.parse(data), definition: "tokens")
        return try JSONDecoder().decode(Self.self, from: data)
    }
}
