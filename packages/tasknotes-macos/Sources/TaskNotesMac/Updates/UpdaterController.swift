internal import Foundation
// `Observable` appears in this type's public conformance list, so the module
// that declares it has to be imported publicly — `InternalImportsByDefault`
// makes that a compile error rather than a style question.
public import Observation
internal import Sparkle
internal import os

/// Sparkle, owned for the app's whole lifetime.
///
/// ## Why it is owned by ``AppEnvironment``
///
/// Same reason as the quick-add hotkey: Sparkle's value is the *scheduled*
/// background check, which has to keep running while no window is open.
/// `AppEnvironment` is the `@State` initial value of the `App` struct and is
/// therefore built at launch before any scene exists, so an updater created
/// here is running from launch and survives the last window closing. An updater
/// created by a view's `.task` would have tied "does this app receive security
/// updates" to the lifetime of a window the user is allowed to close.
///
/// ## Why the updater is conditional
///
/// Sparkle needs two facts that are **not** knowable from source: the appcast
/// URL and the base64 EdDSA public key whose private half signs releases. Both
/// live in `Info.plist` (`SUFeedURL`, `SUPublicEDKey`), both are public values
/// rather than secrets, and both are supplied by `project.yml` — see the
/// comment there for the operator procedure.
///
/// Until they are set, this object deliberately does **not** construct an
/// `SPUStandardUpdaterController` at all, and the menu item stays present and
/// disabled. The alternative — construct it anyway — is worse in two concrete,
/// verified ways rather than as a matter of taste:
///
///   * An **empty** `SUPublicEDKey` is not the same as an absent one.
///     `-[SPUUpdater startUpdater:]` classifies it as
///     `SUSigningInputStatusInvalid` and refuses to start, and
///     `SPUStandardUpdaterController` answers a failed start by running a modal
///     *"Unable to Check For Updates"* alert one second into launch. A
///     placeholder key would therefore put a modal in front of every developer
///     on every launch.
///   * With **both** keys absent, `startUpdater` actually succeeds (it only
///     requires a feed URL when asked to, and an unsigned-but-code-signed
///     bundle is still permitted with a deprecation warning) — so
///     `canCheckForUpdates` would report `true` and the menu item would look
///     live while every check errored out. A disabled item is the honest
///     rendering of "this build has no update channel".
///
/// The condition is not a silent fallback: it is logged once, by name, and
/// `bun run mac:release` refuses to archive a build whose `Info.plist` is
/// missing either key. The loud failure is at the point where it matters, which
/// is shipping, not developing.
@MainActor
@Observable
public final class UpdaterController {
    /// Whether a user-initiated check is possible right now.
    ///
    /// Mirrors `-[SPUUpdater canCheckForUpdates]`, which is `NO` while a check
    /// is already in flight. This is what greys the menu item out; it is never
    /// what *hides* it.
    public private(set) var canCheckForUpdates = false

    /// `nil` when this build has no update channel. See the type's comment.
    @ObservationIgnored private let controller: SPUStandardUpdaterController?

    @ObservationIgnored private var observation: NSKeyValueObservation?

    /// The `Info.plist` keys that decide whether an updater exists at all.
    ///
    /// Spelled here rather than inline because `scripts/release.ts` checks the
    /// exact same two keys in the exported bundle, and a rename that hit only
    /// one of the two would produce a shipped build with a permanently disabled
    /// Check for Updates item and no failure anywhere.
    public static let feedURLKey = "SUFeedURL"
    public static let publicKeyKey = "SUPublicEDKey"

    private static let log = Logger(
        subsystem: "red.sjer.tasknotes.mac",
        category: "updates"
    )

    /// Whether this bundle has an update channel at all.
    ///
    /// Pure and taking both values, rather than reading `Bundle.main` inline,
    /// for one reason: **both dimensions have three states and the interesting
    /// failures are in the cross product, not on either axis.** A present feed
    /// with an *empty* key is the case that makes Sparkle run a modal alert on
    /// launch; a present key with no feed is the case that makes every check
    /// error out behind an enabled menu item. Neither shows up in a test that
    /// varies one key at a time with the other absent.
    ///
    /// Empty is treated exactly like absent, and that asymmetry is the point:
    /// to Sparkle an *absent* `SUPublicEDKey` is a legacy configuration it
    /// tolerates, while an *empty* one is `SUSigningInputStatusInvalid` and a
    /// hard start failure. This app wants neither, so it refuses both.
    static func isConfigured(feedURL: String?, publicKey: String?) -> Bool {
        guard let feedURL, let publicKey else { return false }
        return !feedURL.isEmpty && !publicKey.isEmpty
    }

    /// Build the updater over the running bundle.
    ///
    /// Takes no bundle parameter on purpose. Sparkle reads `Bundle.main`
    /// itself — `SPUStandardUpdaterController` hard-codes it as both host and
    /// application bundle — so a parameter here could only disagree with what
    /// the updater actually used, which is the kind of second source of truth
    /// that reads as configurable and is not.
    public init() {
        let bundle = Bundle.main
        guard
            Self.isConfigured(
                feedURL: bundle.object(forInfoDictionaryKey: Self.feedURLKey) as? String,
                publicKey: bundle.object(forInfoDictionaryKey: Self.publicKeyKey) as? String
            )
        else {
            controller = nil
            Self.log.notice(
                """
                Automatic updates are off: this bundle has no \
                \(Self.feedURLKey, privacy: .public) or \
                \(Self.publicKeyKey, privacy: .public). Expected for a local \
                build; mac:release refuses to archive without them.
                """
            )
            return
        }

        // `startingUpdater: true` is Sparkle's documented default and the one
        // that makes the scheduled background check start on its own. There is
        // no updater delegate and no user-driver delegate: every behaviour this
        // app wants is a default or an `Info.plist` key, and Sparkle's own API
        // guidance is that configuration belongs in `Info.plist` rather than in
        // runtime property writes.
        //
        // Named `standard` rather than `controller` because `variable_shadowing`
        // is on and the stored property is already called that — worth the
        // awkward name, since a shadowed binding is exactly how "assigned the
        // local, never the property" bugs survive review.
        let standard = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
        controller = standard

        // KVO rather than Combine. Sparkle's own SwiftUI sample reaches for
        // `publisher(for:)` + `ObservableObject`, which this app has no other
        // use for — `@Observable` replaced it — and which would drag Combine in
        // for one boolean.
        //
        // ⚠️ The callback reads nothing from its own arguments and instead
        // re-reads through `self`. Under `-default-isolation MainActor` the
        // whole of Sparkle's unannotated Objective-C surface is imported as
        // main-actor-isolated, so `updater.canCheckForUpdates` is simply
        // unreachable from the `@Sendable` change handler; a main-actor class
        // *is* `Sendable`, so `self` is the one thing that can cross.
        observation = standard.updater.observe(\.canCheckForUpdates, options: [.new]) {
            [weak self] _, _ in
            // Sparkle mutates this property on the main thread — it exists to
            // drive `-validateMenuItem:`, which AppKit only ever calls there.
            // `assumeIsolated` traps if that ever stops being true, which is
            // the loud failure the principles ask for. The alternative, hopping
            // through a `Task { @MainActor in … }`, is worse than it looks:
            // enqueued main-actor jobs have no ordering guarantee against each
            // other, so two rapid transitions could land out of order and leave
            // the item permanently disabled after a check that finished.
            MainActor.assumeIsolated { self?.refreshCanCheckForUpdates() }
        }
        refreshCanCheckForUpdates()
    }

    /// Re-read Sparkle's answer.
    ///
    /// Called once after the observation is installed rather than asking KVO
    /// for `.initial`, so nothing runs back into a half-built object, and
    /// re-read rather than taking `change.newValue` so there is one expression
    /// in the type that decides what the menu item's enabled state means.
    private func refreshCanCheckForUpdates() {
        canCheckForUpdates = controller?.updater.canCheckForUpdates ?? false
    }

    /// Run a user-initiated check.
    ///
    /// Does nothing when there is no update channel, which is the same state
    /// that leaves ``canCheckForUpdates`` false — so the menu item is already
    /// disabled and this cannot be reached from the UI.
    public func checkForUpdates() {
        controller?.checkForUpdates(nil)
    }
}
