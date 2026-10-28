import Foundation

nonisolated internal enum FacetAcceptanceInputAction: String {
    case clear, email, password, verification, finish
    case clearVault = "clear-vault"
    case vaultPassword = "vault-password"
}

/// Pure acceptance protocol admission; no field values enter its state or diagnostics.
nonisolated internal struct FacetAcceptanceInputAdmission {
    private let initialStage: String
    private var requests: Set<String>
    private var actions: Set<String> = []
    private var active = true
    internal init(initialStage: String, bindRequest: String) {
        self.initialStage = initialStage
        requests = [bindRequest]
    }
    internal mutating func invalidate() { active = false }
    internal mutating func admit(request: String, action: String, stage: String) -> Bool {
        guard let kind = FacetAcceptanceInputAction(rawValue: action),
            active, actions.count < 7, requests.insert(request).inserted,
            actions.insert(action).inserted
        else {
            active = false
            return false
        }
        let allowed: Bool
        switch kind {
        case .clear: allowed = stage == "credentials" && actions.count == 1
        case .email:
            allowed =
                stage == "credentials" && actions.contains("clear") && !actions.contains("password")
        case .password: allowed = stage == "credentials" && actions.contains("email")
        case .verification:
            allowed =
                stage == "verification"
                && (actions.contains("password") || initialStage == "verification")
        case .clearVault: allowed = stage == "vaults"
        case .vaultPassword: allowed = stage == "vaults" && actions.contains("clear-vault")
        case .finish: allowed = true
        }
        if !allowed || action == "finish" { active = false }
        return allowed
    }
}
