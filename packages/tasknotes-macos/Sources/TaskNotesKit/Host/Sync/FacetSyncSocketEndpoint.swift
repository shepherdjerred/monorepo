import Foundation

/// Public session construction always chooses the official destination. The
/// loopback case exists only in Debug and is supplied by headless test code.
internal enum FacetSyncSocketEndpoint: Sendable {
    case official
    #if DEBUG
        case loopbackFixture(URL)
    #endif

    func resolve(_ address: String, expectedHost: String) throws -> URL {
        guard let official = URL(string: address), official.scheme == "wss",
            official.host == expectedHost, official.port == nil,
            official.user == nil, official.password == nil,
            official.path.isEmpty || official.path == "/",
            official.query == nil, official.fragment == nil
        else { throw FacetSyncError.transport }
        switch self {
        case .official: return official
        #if DEBUG
            case .loopbackFixture(let url):
                guard expectedHost == "sync-fixture.obsidian.md", url.scheme == "ws",
                    url.host == "127.0.0.1", let port = url.port, (1...65_535).contains(port),
                    url.user == nil, url.password == nil, url.path == "/sync",
                    url.query == nil, url.fragment == nil
                else { throw FacetSyncError.transport }
                return url
        #endif
        }
    }
}
