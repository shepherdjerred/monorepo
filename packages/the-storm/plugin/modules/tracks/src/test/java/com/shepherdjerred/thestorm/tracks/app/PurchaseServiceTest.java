package com.shepherdjerred.thestorm.tracks.app;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.DEFAULT_PRICING;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import com.shepherdjerred.thestorm.tracks.domain.purchase.PurchaseRules;
import com.shepherdjerred.thestorm.tracks.domain.purchase.TrackStanding;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class PurchaseServiceTest {

  private static final Duration DAY = Duration.ofHours(24);
  private static final UUID ALICE = new UUID(0, 1);
  private static final AccountId ALICE_ACCOUNT = new AccountId.Player(ALICE);

  private final TestRuntime test = new TestRuntime();
  private final FakeWallets wallets = new FakeWallets();
  private final PurchaseService service =
      new PurchaseService(test.runtime, wallets, PurchaseRules.standard(DEFAULT_PRICING, DAY));

  @BeforeEach
  void aliceIsOnline() {
    online(TrackProgress.empty());
  }

  private void online(TrackProgress progress) {
    test.store.put(ALICE, progress);
    test.cache.quit(ALICE);
    test.cache.joined(ALICE);
    test.cache.loaded(ALICE, progress);
  }

  private Quote quote(Track track) {
    return switch (service.quote(ALICE, track).join()) {
      case Result.Ok<Quote, List<PurchaseProblem>>(var quote) -> quote;
      case Result.Err<Quote, List<PurchaseProblem>>(var problems) ->
          throw new AssertionError("no quote: " + problems);
    };
  }

  @Test
  void buyingChargesStoresCachesAndGrants() {
    wallets.give(ALICE_ACCOUNT, 5_000);
    var quote = quote(MECHANIC);

    var result = service.buy(ALICE, quote).join();

    assertThat(result).isEqualTo(Result.ok(new Purchase(quote, true, 1)));
    assertThat(quote).isEqualTo(new Quote(MECHANIC, 1, 1_000));
    assertThat(wallets.balanceOf(ALICE_ACCOUNT)).isEqualTo(4_000);
    var receipt = wallets.receipts().getFirst();
    assertThat(receipt.from()).isEqualTo(ALICE_ACCOUNT);
    assertThat(receipt.to()).isEqualTo(new AccountId.Server());
    assertThat(receipt.amount()).isEqualTo(Crystals.of(1_000));
    assertThat(receipt.reason()).isEqualTo("track:mechanic:1");
    var stored = owning(MECHANIC, 1).purchased(MECHANIC, 1, NOW);
    assertThat(test.store.get(ALICE)).isEqualTo(stored);
    assertThat(test.cache.progress(ALICE)).contains(stored);
    assertThat(test.cache.level(ALICE, MECHANIC)).isEqualTo(1);
    assertThat(test.permissions.groupsOf(ALICE)).containsExactly("storm-mechanic-1");
  }

  @Test
  void aSecondTrackIsNotPrimaryAndCostsHalfAgain() {
    online(owning(MECHANIC, 1));
    wallets.give(ALICE_ACCOUNT, 5_000);
    var quote = quote(ENGINEER);

    var result = service.buy(ALICE, quote).join();

    assertThat(quote).isEqualTo(new Quote(ENGINEER, 1, 1_500));
    assertThat(result).isEqualTo(Result.ok(new Purchase(quote, false, 1)));
    assertThat(wallets.balanceOf(ALICE_ACCOUNT)).isEqualTo(3_500);
    assertThat(test.permissions.groupsOf(ALICE))
        .containsExactlyInAnyOrder("storm-mechanic-1", "storm-engineer-1");
  }

  @Test
  void aQuoteListsEveryProblemAndChargesNothing() {
    online(owning(MECHANIC, 1, ENGINEER, 1));

    var result = service.quote(ALICE, ENGINEER).join();

    assertThat(result)
        .isEqualTo(
            Result.err(
                List.of(
                    new PurchaseProblem.AbovePrimary(ENGINEER, 2, MECHANIC, 1),
                    new PurchaseProblem.CannotAfford(3_750, 0))));
    assertThat(wallets.receipts()).isEmpty();
  }

  @Test
  void aRefusedChargeStoresNothing() {
    wallets.give(ALICE_ACCOUNT, 5_000);
    var quote = quote(MECHANIC);
    wallets.refuseNext(1);

    var result = service.buy(ALICE, quote).join();

    assertThat(result)
        .isEqualTo(Result.err(List.of(new PurchaseProblem.CannotAfford(1_000, 5_000))));
    assertThat(test.store.updates()).isZero();
    assertThat(test.store.get(ALICE)).isEqualTo(TrackProgress.empty());
    assertThat(test.cache.level(ALICE, MECHANIC)).isZero();
    assertThat(test.permissions.applied()).isZero();
    assertThat(wallets.balanceOf(ALICE_ACCOUNT)).isEqualTo(5_000);
  }

  @Test
  void aFailedChargeStoresNothingAndFails() {
    wallets.give(ALICE_ACCOUNT, 5_000);
    var quote = quote(MECHANIC);
    wallets.failAfter(0);

    var purchase = service.buy(ALICE, quote);

    assertThatThrownBy(purchase::join).isInstanceOf(CompletionException.class);
    assertThat(test.store.updates()).isZero();
    assertThat(wallets.balanceOf(ALICE_ACCOUNT)).isEqualTo(5_000);
  }

  @Test
  void aFailedWriteIsRefunded() {
    wallets.give(ALICE_ACCOUNT, 5_000);
    var quote = quote(MECHANIC);
    test.store.failUpdates();

    var result = service.buy(ALICE, quote).join();

    assertThat(result).isEqualTo(Result.err(List.of(new PurchaseProblem.NotRecorded(quote))));
    assertThat(wallets.balanceOf(ALICE_ACCOUNT)).isEqualTo(5_000);
    assertThat(wallets.receipts())
        .extracting(receipt -> receipt.reason())
        .containsExactly("track:mechanic:1", "track-refund:mechanic:1");
    assertThat(wallets.receipts().getLast().to()).isEqualTo(ALICE_ACCOUNT);
    assertThat(test.store.get(ALICE)).isEqualTo(TrackProgress.empty());
    assertThat(test.cache.level(ALICE, MECHANIC)).isZero();
    assertThat(test.permissions.applied()).isZero();
  }

  @Test
  void aChangeDuringThePurchaseIsRefundedAndKept() {
    wallets.give(ALICE_ACCOUNT, 5_000);
    var quote = quote(MECHANIC);
    var adminChange = owning(ENGINEER, 3);
    test.store.beforeUpdate(() -> test.store.put(ALICE, adminChange));

    var result = service.buy(ALICE, quote).join();

    assertThat(result).isEqualTo(Result.err(List.of(new PurchaseProblem.NotRecorded(quote))));
    assertThat(wallets.balanceOf(ALICE_ACCOUNT)).isEqualTo(5_000);
    assertThat(test.store.get(ALICE)).isEqualTo(adminChange);
  }

  @Test
  void aFailedRefundFailsLoudly() {
    wallets.give(ALICE_ACCOUNT, 5_000);
    var quote = quote(MECHANIC);
    test.store.failUpdates();
    wallets.failAfter(1);

    var purchase = service.buy(ALICE, quote);

    assertThatThrownBy(purchase::join)
        .isInstanceOf(CompletionException.class)
        .hasMessageContaining("refund failed");
    assertThat(wallets.balanceOf(ALICE_ACCOUNT)).isEqualTo(4_000);
  }

  @Test
  void aQuoteThatNoLongerMatchesIsRefusedBeforeCharging() {
    wallets.give(ALICE_ACCOUNT, 5_000);
    var stale = quote(MECHANIC);
    test.store.put(ALICE, owning(ENGINEER, 1));

    var result = service.buy(ALICE, stale).join();

    assertThat(result)
        .isEqualTo(
            Result.err(
                List.of(new PurchaseProblem.QuoteChanged(stale, new Quote(MECHANIC, 1, 1_500)))));
    assertThat(wallets.receipts()).isEmpty();
  }

  @Test
  void theStoredProgressIsCheckedNotTheCache() {
    wallets.give(ALICE_ACCOUNT, 50_000);
    var quote = quote(MECHANIC);
    test.store.put(ALICE, owning(MECHANIC, 1));

    var result = service.buy(ALICE, quote).join();

    assertThat(result)
        .isEqualTo(Result.err(List.of(new PurchaseProblem.NotNextLevel(MECHANIC, 1, 1))));
    assertThat(wallets.receipts()).isEmpty();
  }

  @Test
  void theCooldownStopsASecondPurchaseUntilItEnds() {
    wallets.give(ALICE_ACCOUNT, 50_000);
    assertThat(service.buy(ALICE, quote(MECHANIC)).join().isOk()).isTrue();

    var tooSoon = service.quote(ALICE, MECHANIC).join();
    test.advance(DAY);
    var onTime = service.quote(ALICE, MECHANIC).join();

    assertThat(tooSoon)
        .isEqualTo(Result.err(List.of(new PurchaseProblem.CoolingDown(NOW.plus(DAY)))));
    assertThat(onTime).isEqualTo(Result.ok(new Quote(MECHANIC, 2, 2_500)));
  }

  @Test
  void aPlayerWhoseTracksHaveNotLoadedCannotBuy() {
    test.cache.quit(ALICE);
    test.cache.joined(ALICE);

    assertThat(service.quote(ALICE, MECHANIC).join())
        .isEqualTo(Result.err(List.of(new PurchaseProblem.StillLoading())));
    assertThat(service.buy(ALICE, new Quote(MECHANIC, 1, 1_000)).join())
        .isEqualTo(Result.err(List.of(new PurchaseProblem.StillLoading())));
    assertThat(service.overview(ALICE).join())
        .isEqualTo(Result.err(new PurchaseProblem.StillLoading()));
  }

  @Test
  void onlyOnePurchaseRunsAtATime() {
    wallets.give(ALICE_ACCOUNT, 5_000);
    var quote = quote(MECHANIC);
    var gate = new CompletableFuture<Void>();
    test.store.holdLoads(gate);

    var first = service.buy(ALICE, quote);
    var second = service.buy(ALICE, quote).join();
    gate.complete(null);

    assertThat(second).isEqualTo(Result.err(List.of(new PurchaseProblem.AlreadyBuying())));
    assertThat(first.join().isOk()).isTrue();
    assertThat(wallets.receipts()).hasSize(1);
  }

  @Test
  void aFinishedPurchaseFreesThePlayerToBuyAgain() {
    wallets.give(ALICE_ACCOUNT, 50_000);
    var refused = new Quote(MECHANIC, 1, 999);
    assertThat(service.buy(ALICE, refused).join().isOk()).isFalse();

    assertThat(service.buy(ALICE, quote(MECHANIC)).join().isOk()).isTrue();
  }

  @Test
  void aFailedPermissionSyncDoesNotUndoThePurchase() {
    wallets.give(ALICE_ACCOUNT, 5_000);
    test.permissions.failFromNowOn();

    var result = service.buy(ALICE, quote(MECHANIC)).join();

    assertThat(result.isOk()).isTrue();
    assertThat(test.store.get(ALICE).level(MECHANIC)).isEqualTo(1);
  }

  @Test
  void theOverviewUsesTheCacheAndBalance() {
    online(owning(MECHANIC, 2));
    wallets.give(ALICE_ACCOUNT, 1_500);

    var overview =
        service
            .overview(ALICE)
            .join()
            .fold(standings -> standings, problem -> List.<TrackStanding>of());

    assertThat(overview).hasSize(Track.values().length);
    var mechanic = overview.get(1);
    assertThat(mechanic.level()).isEqualTo(2);
    assertThat(mechanic.primary()).isTrue();
    assertThat(mechanic.next()).contains(new Quote(MECHANIC, 3, 5_000));
    assertThat(mechanic.buyable()).isFalse();
    assertThat(overview.getFirst().next())
        .isEqualTo(Optional.of(new Quote(Track.SHOPKEEPER, 1, 1_500)));
    assertThat(overview.getFirst().buyable()).isTrue();
  }

  @Test
  void ledgerReasonsNameTheTrackAndLevel() {
    var quote = new Quote(Track.SPELLCASTER, 4, 10);

    assertThat(PurchaseService.reason(quote)).isEqualTo("track:spellcaster:4");
    assertThat(PurchaseService.refundReason(quote)).isEqualTo("track-refund:spellcaster:4");
  }
}
