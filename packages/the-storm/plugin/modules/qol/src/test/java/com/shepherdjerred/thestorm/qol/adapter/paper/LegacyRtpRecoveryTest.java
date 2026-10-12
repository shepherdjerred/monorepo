package com.shepherdjerred.thestorm.qol.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.adapter.db.JooqLedgerStore;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.LedgerWallets;
import com.shepherdjerred.thestorm.economy.domain.TransferRules;
import com.shepherdjerred.thestorm.qol.adapter.db.JooqQolStore;
import com.shepherdjerred.thestorm.qol.app.RtpAttempt;
import java.nio.file.Path;
import java.time.Instant;
import java.time.InstantSource;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class LegacyRtpRecoveryTest {
  @TempDir Path directory;
  StormDatabase database;
  JooqQolStore store;
  LedgerWallets wallets;
  final UUID player = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  final Instant now = Instant.parse("2026-10-04T12:00:00Z");

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("recovery.db"));
    database.migrate("qol", getClass().getClassLoader());
    database.migrate("economy", getClass().getClassLoader());
    store = new JooqQolStore(database);
    wallets =
        new LedgerWallets(
            new JooqLedgerStore(database, InstantSource.fixed(now), TransferRules.standard()),
            Crystals.of(500));
    wallets
        .transfer(new AccountId.Server(), new AccountId.Player(player), Crystals.of(500), "seed")
        .join();
  }

  @AfterEach
  void close() {
    database.close();
  }

  private RtpAttempt pendingCharge() {
    var attempt = new RtpAttempt(UUID.randomUUID(), player, 25);
    store.insertRtpAttempt(attempt).join();
    wallets
        .transferOnce(
            new KeyedTransfer(
                attempt.id(),
                new AccountId.Player(player),
                new AccountId.Server(),
                Crystals.of(25),
                "random teleport"))
        .join();
    return attempt;
  }

  @Test
  void recoveryKeepsOriginalKeysAndDoesNotRepeatAnAlreadyCommittedRefund() {
    var attempt = pendingCharge();
    wallets
        .transferOnce(
            new KeyedTransfer(
                attempt.refundKey(),
                new AccountId.Server(),
                new AccountId.Player(player),
                Crystals.of(25),
                "rtp refund"))
        .join();
    var uncharged = new RtpAttempt(UUID.randomUUID(), player, 25);
    store.insertRtpAttempt(uncharged).join();
    var seen = now.minusSeconds(600);
    store.ensure(player, seen).join();
    store.setLastRtp(player, now).join();

    LegacyRtpRecovery.start(store, wallets).join();
    LegacyRtpRecovery.start(store, wallets).join();
    assertThat(store.pendingRtpAttempts().join()).isEmpty();
    assertThat(wallets.balance(new AccountId.Player(player)).join().amount()).isEqualTo(500);
    assertThat(wallets.receiptFor(attempt.refundKey()).join()).isPresent();
    var profile = store.ensure(player, now.plusSeconds(1)).join().profile();
    assertThat(profile.firstSeen()).isEqualTo(seen);
    assertThat(profile.lastRtp()).contains(now);
  }

  @Test
  void chargedObligationIsRetainedWhenTheLedgerRefusesItsRefund() {
    var attempt = pendingCharge();
    wallets
        .transferOnce(
            new KeyedTransfer(
                attempt.refundKey(),
                new AccountId.Server(),
                new AccountId.Player(player),
                Crystals.of(1),
                "conflicting transfer"))
        .join();
    assertThatThrownBy(() -> LegacyRtpRecovery.start(store, wallets).join())
        .hasRootCauseInstanceOf(IllegalArgumentException.class);
    assertThat(store.pendingRtpAttempts().join()).containsExactly(attempt);
  }

  @Test
  void chargedAttemptGetsCompensatedExactlyOnce() {
    var attempt = pendingCharge();
    assertThat(wallets.balance(new AccountId.Player(player)).join().amount()).isEqualTo(475);
    LegacyRtpRecovery.start(store, wallets).join();
    LegacyRtpRecovery.start(store, wallets).join();
    assertThat(wallets.balance(new AccountId.Player(player)).join().amount()).isEqualTo(500);
    assertThat(wallets.receiptFor(attempt.refundKey()).join()).isPresent();
    assertThat(store.pendingRtpAttempts().join()).isEmpty();
  }
}
