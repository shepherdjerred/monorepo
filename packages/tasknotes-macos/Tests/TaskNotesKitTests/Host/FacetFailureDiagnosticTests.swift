import Foundation
import TaskNotesUniFFI
import Testing

@testable import TaskNotesKit

struct FacetFailureDiagnosticTests {
    @Test func diagnosticsPreserveClassificationAndUnderlyingCausesWithoutUserData() {
        let cause = NSError(
            domain: NSURLErrorDomain, code: NSURLErrorTimedOut,
            userInfo: [NSLocalizedDescriptionKey: "account token and private bytes"])
        let storage = NSError(
            domain: NSPOSIXErrorDomain, code: Int(ENOSPC),
            userInfo: [NSUnderlyingErrorKey: cause, NSLocalizedDescriptionKey: "/private/vault"])
        let diagnostic = FacetFailureDiagnostic(storage)
        #expect(diagnostic.classification == "storage")
        #expect(diagnostic.chain == "first:storage,cause:network")
        #expect(!diagnostic.chain.contains("token"))
        #expect(!diagnostic.action.contains("/private"))
    }

    @Test func corruptContractsRemainDistinctFromExpectedNetworkFailures() {
        #expect(
            FacetFailureDiagnostic(FacetContractError.unsupportedResponse).classification
                == "internal_contract")
        #expect(FacetFailureDiagnostic(FacetSyncError.transport).classification == "network")
        #expect(
            FacetFailureDiagnostic(FacetEngineError.Configuration(detail: "private note"))
                .classification == "configuration")
    }

    @Test func diagnosticCausesAreBounded() {
        let causes = (0..<40).map { _ in NSError(domain: NSPOSIXErrorDomain, code: Int(EIO)) }
        let failure = NSError(
            domain: NSPOSIXErrorDomain, code: Int(ENOSPC),
            userInfo: [NSMultipleUnderlyingErrorsKey: causes])
        let diagnostic = FacetFailureDiagnostic(failure)
        #expect(diagnostic.chain.hasSuffix("truncated"))
        #expect(diagnostic.chain.split(separator: ",").count == 17)
    }
}
