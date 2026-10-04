package com.shepherdjerred.thestorm.rwf.app;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqMatchStore;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.Outcome;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.PayoutStatus;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore.PlayerRow;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.testing.FakeClock;
import com.shepherdjerred.thestorm.rwf.testing.FakeWallets;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.nio.file.Path;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Payouts go through the outbox once, under the daily cap, and replay after a crash. */
final class PayoutServiceTest {

  private static final UUID ALICE = Samples.ALICE.uuid();
  private static final UUID BOB = Samples.BOB.uuid();

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
    payouts =
        new PayoutService(
            wallets, store, new PayoutService.Settings(5, ZoneId.of("UTC")), new FakeClock(T0));
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
        match, player, TeamColor.RED, "trooper", 0, 0, outcome, credits, PayoutStatus.PENDING, 0);
  }

  @Test
  void settlingPaysEveryHumanOwedWithTheMatchKey() {
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
            org.assertj.core.groups.Tuple.tuple(
                new AccountId.Player(ALICE), Crystals.of(3), "rwf:" + id + ":WIN"),
            org.assertj.core.groups.Tuple.tuple(
                new AccountId.Player(BOB), Crystals.of(1), "rwf:" + id + ":LOSE"));
    assertThat(store.unpaid().join()).isEmpty();
  }

  @Test
  void theDailyCapForfeitsTheRest() {
    var first = UUID.randomUUID();
    var second = UUID.randomUUID();
    payouts.settle(match(first), List.of(owed(first, ALICE, Outcome.WIN, 3))).join();

    var paid = payouts.settle(match(second), List.of(owed(second, ALICE, Outcome.WIN, 3))).join();

    assertThat(paid).singleElement().satisfies(p -> assertThat(p.paid()).isEqualTo(2));
    assertThat(wallets.receipts()).extracting(r -> r.amount().amount()).containsExactly(3L, 2L);
  }

  @Test
  void replayPaysWhatACrashLeftPendingExactlyOnce() {
    var id = UUID.randomUUID();
    store.record(match(id), List.of(owed(id, ALICE, Outcome.WIN, 3))).join();
    store.beginPayout(id, ALICE, java.time.LocalDate.of(2026, 10, 3), 5).join();

    var replayed = payouts.replay().join();
    var again = payouts.replay().join();

    assertThat(replayed).singleElement().satisfies(p -> assertThat(p.paid()).isEqualTo(3));
    assertThat(again).isEmpty();
    assertThat(wallets.receipts()).hasSize(1);
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
