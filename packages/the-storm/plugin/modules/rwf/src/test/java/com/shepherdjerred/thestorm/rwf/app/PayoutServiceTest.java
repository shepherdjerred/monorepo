package com.shepherdjerred.thestorm.rwf.app;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.groups.Tuple.tuple;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqMatchStore;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.Outcome;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.PayoutStatus;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.PlayerRow;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.testing.FakeWallets;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Payouts go through the outbox once, in Red Warfare credits with no daily cap, take the AFK
 * penalty without overdrawing, and replay after a crash.
 */
final class PayoutServiceTest {

  private static final UUID ALICE = Samples.ALICE.uuid();
  private static final UUID BOB = Samples.BOB.uuid();
  private static final AccountId.Player ALICE_ACCOUNT = new AccountId.Player(ALICE);

  @TempDir Path directory;
  private StormDatabase database;
  private MatchStore store;
  private FakeWallets wallets;
  private PayoutService payouts;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("rwf", getClass().getClassLoader());
    store = new JooqMatchStore(database);
    wallets = new FakeWallets();
    payouts = new PayoutService(wallets, store);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static MatchStore.MatchRow match(UUID id) {
    return new MatchStore.MatchRow(
        id, "training-yard", T0, T0.plusSeconds(120), Optional.of(TeamColor.RED), 2, 0);
  }

  private static PlayerRow owed(UUID match, UUID player, Outcome outcome, long credits) {
    return new PlayerRow(
        match,
        player,
        TeamColor.RED,
        "trooper",
        0,
        0,
        outcome,
        PayoutService.CURRENCY,
        credits,
        PayoutStatus.PENDING,
        0);
  }

  @Test
  void settlingPaysEveryHumanOwedInRedWarfareCreditsWithTheMatchKey() {
    var id = UUID.randomUUID();

    var paid =
        payouts
            .settle(
                match(id), List.of(owed(id, ALICE, Outcome.WIN, 3), owed(id, BOB, Outcome.LOSE, 1)))
            .join();

    assertThat(paid).extracting(PayoutService.Paid::paid).containsExactly(3L, 1L);
    assertThat(wallets.receipts())
        .extracting(Receipt::to, Receipt::amount, Receipt::reason)
        .containsExactly(
            tuple(ALICE_ACCOUNT, Money.rwfCredits(3), "rwf:" + id + ":WIN"),
            tuple(new AccountId.Player(BOB), Money.rwfCredits(1), "rwf:" + id + ":LOSE"));
    assertThat(wallets.held(ALICE_ACCOUNT, CurrencyId.CRYSTALS)).isEqualTo(Money.crystals(0));
    assertThat(store.unpaid().join()).isEmpty();
  }

  @Test
  void thereIsNoDailyCap() {
    for (var i = 0; i < 20; i++) {
      var id = UUID.randomUUID();
      payouts.settle(match(id), List.of(owed(id, ALICE, Outcome.WIN, 3))).join();
    }

    assertThat(wallets.held(ALICE_ACCOUNT, CurrencyId.RWF_CREDITS)).isEqualTo(Money.rwfCredits(60));
  }

  @Test
  void theAfkPenaltyTakesTwoCredits() {
    wallets.hold(ALICE_ACCOUNT, Money.rwfCredits(5));
    var id = UUID.randomUUID();

    var paid = payouts.settle(match(id), List.of(owed(id, ALICE, Outcome.AFK, -2))).join();

    assertThat(paid).singleElement().isEqualTo(new PayoutService.Paid(id, ALICE, -2, -2));
    assertThat(wallets.receipts())
        .extracting(Receipt::from, Receipt::to, Receipt::amount, Receipt::reason)
        .containsExactly(
            tuple(
                ALICE_ACCOUNT, new AccountId.Server(), Money.rwfCredits(2), "rwf:" + id + ":AFK"));
    assertThat(wallets.held(ALICE_ACCOUNT, CurrencyId.RWF_CREDITS)).isEqualTo(Money.rwfCredits(3));
    assertThat(store.players(id).join())
        .singleElement()
        .satisfies(row -> assertThat(row.creditsPaid()).isEqualTo(-2));
  }

  @Test
  void theAfkPenaltyNeverOverdraws() {
    wallets.hold(ALICE_ACCOUNT, Money.rwfCredits(1));
    var first = UUID.randomUUID();

    var paid =
        payouts
            .settle(
                match(first),
                List.of(owed(first, ALICE, Outcome.AFK, -2), owed(first, BOB, Outcome.AFK, -2)))
            .join();

    assertThat(paid)
        .containsExactly(
            new PayoutService.Paid(first, ALICE, -2, -1),
            new PayoutService.Paid(first, BOB, -2, 0));
    assertThat(wallets.held(ALICE_ACCOUNT, CurrencyId.RWF_CREDITS)).isEqualTo(Money.rwfCredits(0));
    assertThat(wallets.receipts()).hasSize(1);
    assertThat(store.unpaid().join()).isEmpty();
  }

  @Test
  void aCommittedChargeIsFoundByItsKeyOnReplay() {
    wallets.hold(ALICE_ACCOUNT, Money.rwfCredits(5));
    var id = UUID.randomUUID();
    store.record(match(id), List.of(owed(id, ALICE, Outcome.AFK, -2))).join();
    store.beginPayout(id, ALICE).join();
    // The charge reached the ledger, then the server crashed before the outbox was marked paid.
    wallets
        .transferOnce(
            new KeyedTransfer(
                PayoutService.key(id, ALICE),
                ALICE_ACCOUNT,
                new AccountId.Server(),
                Money.rwfCredits(2),
                PayoutService.reason(id, Outcome.AFK)))
        .join();
    wallets.hold(ALICE_ACCOUNT, Money.rwfCredits(1));

    var replayed = payouts.replay().join();

    assertThat(replayed).containsExactly(new PayoutService.Paid(id, ALICE, -2, -2));
    assertThat(wallets.receipts()).hasSize(1);
    assertThat(wallets.held(ALICE_ACCOUNT, CurrencyId.RWF_CREDITS)).isEqualTo(Money.rwfCredits(1));
  }

  @Test
  void replayPaysWhatACrashLeftPendingExactlyOnce() {
    var id = UUID.randomUUID();
    store.record(match(id), List.of(owed(id, ALICE, Outcome.WIN, 3))).join();
    store.beginPayout(id, ALICE).join();

    var replayed = payouts.replay().join();
    var again = payouts.replay().join();

    assertThat(replayed).singleElement().satisfies(p -> assertThat(p.paid()).isEqualTo(3));
    assertThat(again).isEmpty();
    assertThat(wallets.receipts()).hasSize(1);
  }

  @Test
  void aRowWrittenBeforeRedWarfareCreditsStillSettlesInCrystals() {
    var id = UUID.randomUUID();
    store
        .record(
            match(id),
            List.of(
                new PlayerRow(
                    id,
                    ALICE,
                    TeamColor.RED,
                    "trooper",
                    0,
                    0,
                    Outcome.WIN,
                    CurrencyId.CRYSTALS,
                    3,
                    PayoutStatus.PENDING,
                    0)))
        .join();

    payouts.replay().join();

    assertThat(wallets.receipts()).extracting(Receipt::amount).containsExactly(Money.crystals(3));
    assertThat(wallets.held(ALICE_ACCOUNT, CurrencyId.RWF_CREDITS)).isEqualTo(Money.rwfCredits(0));
  }

  @Test
  void aRepeatedTransferReturnsTheOriginalReceipt() {
    var id = UUID.randomUUID();
    var key = PayoutService.key(id, ALICE);
    payouts.settle(match(id), List.of(owed(id, ALICE, Outcome.WIN, 3))).join();

    assertThat(wallets.receiptFor(key).join()).isPresent();
    assertThat(PayoutService.key(id, ALICE)).isEqualTo(key);
    assertThat(PayoutService.key(id, BOB)).isNotEqualTo(key);
  }
}
