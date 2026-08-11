internal import TaskNotesKit
import Testing

/// The in-memory token store's contract.
///
/// ⚠️ `KeychainTokenStore` is deliberately **not** exercised here. It writes to
/// the login Keychain, so a test against it would leave an entry in the
/// developer's own Keychain and could read or overwrite the one the installed
/// app is using. That is exactly why the protocol exists.
///
/// What is asserted here is the part of the contract both implementations
/// share: empty means absent, and a write that succeeded answers `nil`.
/// `KeychainTokenStore`'s own branch — update in place, add only when there is
/// nothing to update, and never delete a working credential before its
/// replacement has landed — is stated in that type and covered by the local
/// `mac:smoke` run against the real app, because the only honest test of it is
/// one that talks to the Keychain.
@Suite("Server token store")
struct ServerTokenStoreTests {
    @Test("a stored token round-trips")
    func roundTrip() throws {
        let store = InMemoryTokenStore()
        #expect(try store.token().get() == nil)

        #expect(store.setToken("abc123") == nil)
        #expect(try store.token().get() == "abc123")
    }

    /// Empty and absent are the same state, unlike the saved-view storage where
    /// they are deliberately different.
    ///
    /// A bearer token of `""` is not a credential. Keeping one would make the
    /// app send `Authorization: Bearer ` and take a 401 that reads as a server
    /// problem rather than as an unset field — the same class of confusion as a
    /// filter badge counting something the user did not set.
    @Test("clearing the token is spelled the same as never setting one")
    func emptyIsAbsent() throws {
        let store = InMemoryTokenStore(token: "abc123")

        #expect(store.setToken("") == nil)
        #expect(try store.token().get() == nil)

        #expect(store.setToken("abc123") == nil)
        #expect(store.setToken(nil) == nil)
        #expect(try store.token().get() == nil)
    }
}
