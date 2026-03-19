import Foundation
@testable import GlanceApp
import Testing

struct TalosProviderTests {
    @Test
    func `healthy nodes returns ok`() {
        let json = Data("""
        {"spec": {"hostname": "cp-1", \
        "machineType": "controlplane", \
        "operatingSystem": "Talos (v1.7.0)"}}
        {"spec": {"hostname": "w-1", \
        "machineType": "worker", \
        "operatingSystem": "Talos (v1.7.0)"}}
        """.utf8)
        let snapshot = TalosProvider.parse(json)
        #expect(snapshot.status == .ok)
        #expect(snapshot.summary == "2 nodes, 0 not ready")
    }

    @Test
    func `node not ready returns error`() {
        let json = Data("""
        {"spec": {"hostname": "cp", \
        "machineType": "cp", "operatingSystem": "v1"}}
        {"spec": {"hostname": "bad", \
        "machineType": "", "operatingSystem": null}}
        """.utf8)
        let snapshot = TalosProvider.parse(json)
        #expect(snapshot.status == .error)
    }

    @Test
    func `empty output returns unknown`() {
        let snapshot = TalosProvider.parse(Data("".utf8))
        #expect(snapshot.status == .unknown)
    }

    @Test
    func `invalid JSON skipped`() {
        let json = Data("""
        {"spec": {"hostname": "good", \
        "machineType": "w", "operatingSystem": "v1"}}
        {invalid}
        {"spec": {"hostname": "also", \
        "machineType": "cp", "operatingSystem": "v1"}}
        """.utf8)
        let snapshot = TalosProvider.parse(json)
        guard case let .talos(nodes) = snapshot.detail else {
            Issue.record("Expected talos detail")
            return
        }
        #expect(nodes.count == 2)
    }
}
