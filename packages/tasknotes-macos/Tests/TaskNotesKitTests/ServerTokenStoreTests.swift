internal import TaskNotesKit
import Testing

/// The in-memory token store's contract.
///
/// ⚠️ `KeychainTokenStore` is deliberately **not** exercised here. It writes to
/// the login Keychain, so a test against it would leave an entry in the
/// developer's own Keychain and could read or overwrite the one the installed
/// app is using. That is exactly why the protocol exists; the real
/// implementation is four Security-framework calls with no branching worth
/// asserting, and the branch that *is* worth asserting — empty means absent —
/// is stated once here and shared by both.
@Suite("Server token store")
struct ServerTokenStoreTests {
    @Test("a stored token round-trips")
    func roundTrip() {
        let store = InMemoryTokenStore()
        #expect(store.token() == nil)

        store.setToken("abc123")
        #expect(store.token() == "abc123")
    }

    /// Empty and absent are the same state, unlike the saved-view storage where
    /// they are deliberately different.
    ///
    /// A bearer token of `""` is not a credential. Keeping one would make the
    /// app send `Authorization: Bearer ` and take a 401 that reads as a server
    /// problem rather than as an unset field — the same class of confusion as a
    /// filter badge counting something the user did not set.
    @Test("clearing the token is spelled the same as never setting one")
    func emptyIsAbsent() {
        let store = InMemoryTokenStore(token: "abc123")

        store.setToken("")
        #expect(store.token() == nil)

        store.setToken("abc123")
        store.setToken(nil)
        #expect(store.token() == nil)
    }
}
