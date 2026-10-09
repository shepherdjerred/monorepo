import Foundation
import SwiftUI

@testable import TaskNotesFacetUI

/// Synthetic presentation only: no account, engine, HTTP or secure-store access.
internal enum FacetAccountRenderState: String, CaseIterable, Sendable {
    case progress, failure, verification
    case zeroVaults = "zero-vaults"
}

@MainActor
internal struct FacetAccountRenderFixture {
    let store = FacetStore()

    init(_ state: FacetAccountRenderState) {
        switch state {
        case .progress:
            store.accountPresentation.operation = .signingIn
            store.accountPresentation.requestID = UUID()
            store.isLoading = true
        case .failure:
            store.accountPresentation.error =
                "Could not reach Obsidian. Check your connection and try again."
        case .verification:
            store.accountPresentation.stage = .verification
            store.accountNeedsCode = true
            store.accountPresentation.notice =
                "Enter the verification code from your authenticator app."
        case .zeroVaults:
            store.accountPresentation.stage = .vaults
            store.accountPresentation.notice =
                "Signed in. This account has no Obsidian Sync vaults. "
                + "Create a remote vault in Obsidian, then sign in again to refresh this list."
        }
    }

    var view: some View { FacetAccountForm(store: store) }
}
