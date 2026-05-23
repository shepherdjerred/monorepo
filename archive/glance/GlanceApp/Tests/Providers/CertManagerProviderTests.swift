import Foundation
@testable import GlanceApp
import Testing

struct CertManagerProviderTests {
    @Test
    func `all certs ready returns ok`() throws {
        let jsonString = """
        {"items": [{"metadata": {"name": "c1", "namespace": "ns"}, \
        "spec": {"issuerRef": {"name": "le"}}, \
        "status": {"conditions": [{"type": "Ready", "status": "True"}], \
        "notAfter": "2025-06-01T00:00:00Z"}}]}
        """
        let snapshot = try CertManagerProvider.parse(
            Data(jsonString.utf8),
        )
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "1 certificate valid")
    }

    @Test
    func `cert not ready returns warning`() throws {
        let jsonString = """
        {"items": [{"metadata": {"name": "c1", "namespace": "ns"}, \
        "spec": {"issuerRef": {"name": "le"}}, \
        "status": {"conditions": [{"type": "Ready", "status": "False"}], \
        "notAfter": null}}]}
        """
        let snapshot = try CertManagerProvider.parse(
            Data(jsonString.utf8),
        )
        #expect(snapshot.status == .warning)
    }

    @Test
    func `no certs returns unknown`() throws {
        let snapshot = try CertManagerProvider.parse(
            Data("{\"items\": []}".utf8),
        )
        #expect(snapshot.status == .unknown)
    }

    @Test
    func `malformed JSON throws`() {
        #expect(throws: (any Error).self) {
            try CertManagerProvider.parse(Data("x".utf8))
        }
    }
}
