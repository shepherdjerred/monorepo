package com.shepherdjerred.thestorm.towns.app;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.ASSISTANT;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.chunk;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.claim;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimAllowance;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimLimits;
import com.shepherdjerred.thestorm.towns.domain.claiming.ClaimPolicy;
import com.shepherdjerred.thestorm.towns.domain.claiming.Claiming;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import com.shepherdjerred.thestorm.towns.domain.town.MembershipPolicy;
import com.shepherdjerred.thestorm.towns.domain.town.TownProblem;
import com.shepherdjerred.thestorm.towns.domain.town.TownRole;
import com.shepherdjerred.thestorm.towns.domain.treasury.TreasuryProblem;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.OptionalInt;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Treasury deposits and withdrawals by rank, and deleting a town, which pays its treasury out. */
final class TreasuryTest {

  private static final AccountId.Town TREASURY = new AccountId.Town(TOWN_A);

  private final FakeTownsStore store = new FakeTownsStore();
  private final TownsState state = new TownsState(new RegionIndex(List.of()));
  private final FakeWallets wallets = new FakeWallets();
  private final Settling settling =
      new Settling(
          state,
          store,
          new Clocks(
              InstantSource.fixed(Instant.parse("2026-09-25T12:00:00Z")),
              new SplittableRandom(1),
              Runnable::run,
              failure -> {}),
          TownEvents.NONE);
  private final TownService towns =
      new TownService(
          settling,
          new Claiming(
              new ClaimPolicy(
                  Set.of(Fixtures.WORLD),
                  2,
                  new ClaimAllowance(10, List.of(1, 2, 3, 4, 5)),
                  Set.of())),
          player -> OptionalInt.empty());
  private final MembershipService members =
      new MembershipService(
          settling,
          new MembershipPolicy(60, 30),
          new MembershipService.Hooks(
              player -> OptionalInt.empty(),
              ClaimLimits.flat(10),
              MembershipService.Departures.NONE));
  private final Treasury treasury = new Treasury(towns, members, wallets);

  @BeforeEach
  void load() {
    store.seed(Fixtures.townA(), claim(TOWN_A, 0, 0));
    state.load(store.snapshot());
    wallets.give(new AccountId.Player(MEMBER), 500);
    wallets.give(new AccountId.Player(OWNER), 100);
  }

  private static <T, E> T done(CompletableFuture<Result<T, E>> future) {
    return future
        .join()
        .fold(
            value -> value,
            error -> {
              throw new AssertionError("expected success, got " + error);
            });
  }

  private static <T, E> E refused(CompletableFuture<Result<T, E>> future) {
    return future
        .join()
        .fold(
            value -> {
              throw new AssertionError("expected a refusal, got " + value);
            },
            error -> error);
  }

  @Test
  void membersPayInAndSeeTheBalance() {
    var receipt = done(treasury.deposit(MEMBER, Crystals.of(200)));

    assertThat(receipt.amount()).isEqualTo(Crystals.of(200));
    assertThat(wallets.balanceOf(TREASURY)).isEqualTo(200);
    assertThat(wallets.balanceOf(new AccountId.Player(MEMBER))).isEqualTo(300);
    assertThat(done(treasury.balance(MEMBER))).isEqualTo(Crystals.of(200));
  }

  @Test
  void onlyOwnersAndAssistantsWithdraw() {
    wallets.give(TREASURY, 1_000);

    assertThat(refused(treasury.withdraw(MEMBER, Crystals.of(10))))
        .isEqualTo(new TreasuryProblem.CannotWithdraw(TownRole.MEMBER));
    done(treasury.withdraw(ASSISTANT, Crystals.of(300)));
    done(treasury.withdraw(OWNER, Crystals.of(200)));

    assertThat(wallets.balanceOf(TREASURY)).isEqualTo(500);
    assertThat(wallets.balanceOf(new AccountId.Player(ASSISTANT))).isEqualTo(300);
  }

  @Test
  void nobodySpendsMoneyTheyDoNotHave() {
    assertThat(refused(treasury.deposit(OWNER, Crystals.of(101))))
        .isEqualTo(new TreasuryProblem.Insufficient(100));
    assertThat(refused(treasury.withdraw(OWNER, Crystals.of(1))))
        .isEqualTo(new TreasuryProblem.Insufficient(0));
  }

  @Test
  void playersOutsideATownHaveNoTreasury() {
    assertThat(refused(treasury.deposit(NOMAD, Crystals.of(1))))
        .isEqualTo(new TreasuryProblem.NotInTown());
    assertThat(refused(treasury.balance(NOMAD))).isEqualTo(new TreasuryProblem.NotInTown());
  }

  @Test
  void aTownBeingChangedWaitsForItsTreasury() {
    var _ = towns.claim(OWNER, chunk(1, 0));

    assertThat(refused(treasury.deposit(MEMBER, Crystals.of(1))))
        .isEqualTo(new TreasuryProblem.Busy());
  }

  @Test
  void deletingATownPaysItsTreasuryToTheOwnerInOneTransfer() {
    wallets.give(TREASURY, 750);

    var change = done(treasury.delete(OWNER, "Aegis"));
    store.succeed();
    store.succeed();

    assertThat(change.saved()).isCompleted();
    assertThat(state.town(TOWN_A)).isEmpty();
    assertThat(wallets.balanceOf(TREASURY)).isZero();
    assertThat(wallets.balanceOf(new AccountId.Player(OWNER))).isEqualTo(850);
    assertThat(wallets.receipts())
        .singleElement()
        .satisfies(
            receipt -> {
              assertThat(receipt.from()).isEqualTo(TREASURY);
              assertThat(receipt.to()).isEqualTo(new AccountId.Player(OWNER));
            });
  }

  @Test
  void anEmptyTreasuryNeedsNoTransfer() {
    var change = done(treasury.delete(OWNER, "Aegis"));
    store.succeed();
    store.succeed();

    assertThat(change.saved()).isCompleted();
    assertThat(state.town(TOWN_A)).isEmpty();
    assertThat(wallets.receipts()).isEmpty();
  }

  @Test
  void aFailedPayoutRemainsDurableAfterDeletion() {
    wallets.give(TREASURY, 750);
    wallets.failNext(1);

    var change = done(treasury.delete(OWNER, "Aegis"));
    store.succeed();

    assertThat(change.saved()).isCompletedExceptionally();
    assertThat(state.town(TOWN_A)).isEmpty();
    assertThat(store.pendingPayouts().join()).containsExactly(TownPayout.of(Fixtures.townA()));
    assertThat(wallets.balanceOf(TREASURY)).isEqualTo(750);
    assertThat(settling.isSettling()).isFalse();

    var recovered = treasury.recoverPayouts();
    store.succeed();
    assertThat(recovered).isCompleted();
    assertThat(store.pendingPayouts().join()).isEmpty();
    assertThat(wallets.balanceOf(new AccountId.Player(OWNER))).isEqualTo(850);
  }

  @Test
  void aDeleteThatCannotBeSavedNeverPaysOut() {
    wallets.give(TREASURY, 750);

    var change = done(treasury.delete(OWNER, "Aegis"));
    store.fail();

    assertThat(change.saved()).isCompletedExceptionally();
    assertThat(state.town(TOWN_A)).isPresent();
    assertThat(wallets.balanceOf(TREASURY)).isEqualTo(750);
    assertThat(wallets.balanceOf(new AccountId.Player(OWNER))).isEqualTo(100);
  }

  @Test
  void onlyTheOwnerDeletesAndOnlyByName() {
    assertThat(refused(treasury.delete(ASSISTANT, "Aegis")))
        .containsExactly(new TownProblem.NotOwner(TownRole.ASSISTANT));
    assertThat(refused(treasury.delete(OWNER, "Bastion")))
        .containsExactly(new TownProblem.ConfirmationMismatch("Aegis"));
    assertThat(wallets.receipts()).isEmpty();
  }
}
