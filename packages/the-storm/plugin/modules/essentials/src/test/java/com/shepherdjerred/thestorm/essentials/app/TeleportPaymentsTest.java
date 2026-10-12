package com.shepherdjerred.thestorm.essentials.app;

import static java.util.concurrent.CompletableFuture.completedFuture;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportAttemptStore;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore.Confirmation;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Exemptions;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Multiplier;
import com.shepherdjerred.thestorm.essentials.domain.teleport.OnCooldown;
import com.shepherdjerred.thestorm.essentials.domain.teleport.Quote;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPrice;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricer;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPrices;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportPricing;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import com.shepherdjerred.thestorm.essentials.testing.FakeClock;
import com.shepherdjerred.thestorm.essentials.testing.FakeWallets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

final class TeleportPaymentsTest {

  static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000001");
  static final AccountId WALLET = new AccountId.Player(PLAYER);

  /** Usage kept in memory. */
  static final class MemoryUsage implements TeleportUsageStore {
    final Map<UUID, TeleportUsage> usage = new HashMap<>();
    final java.util.Set<UUID> confirmed = new java.util.HashSet<>();
    final MemoryAttempts attempts;

    MemoryUsage(MemoryAttempts attempts) {
      this.attempts = attempts;
    }

    @Override
    public CompletableFuture<Optional<TeleportUsage>> find(UUID player, java.time.Instant since) {
      return completedFuture(Optional.ofNullable(usage.get(player)));
    }

    @Override
    public CompletableFuture<Void> confirm(Confirmation confirmation) {
      var player = confirmation.player();
      var operation = confirmation.operation();
      var next = confirmation.usage();
      if (confirmed.add(operation)) {
        usage.put(player, next);
      }
      return attempts.delete(operation);
    }
  }

  static final class MemoryAttempts implements TeleportAttemptStore {
    final Map<UUID, TeleportAttempt> attempts = new HashMap<>();

    @Override
    public CompletableFuture<Void> insert(TeleportAttempt attempt) {
      attempts.put(attempt.id(), attempt);
      return completedFuture(null);
    }

    @Override
    public CompletableFuture<List<TeleportAttempt>> pending() {
      return completedFuture(new ArrayList<>(attempts.values()));
    }

    @Override
    public CompletableFuture<Void> delete(UUID id) {
      attempts.remove(id);
      return completedFuture(null);
    }
  }

  final FakeClock clock = FakeClock.at("2026-09-25T12:00:00Z");
  final FakeWallets wallets = new FakeWallets();
  final MemoryAttempts attempts = new MemoryAttempts();
  final MemoryUsage usage = new MemoryUsage(attempts);
  final TeleportPayments payments =
      new TeleportPayments(
          new TeleportPricer(pricing()),
          new TeleportPayments.Stores(usage, attempts),
          wallets,
          clock);

  static TeleportPricing pricing() {
    var price = new TeleportPrice(25, Duration.ofMinutes(1), 1);
    return new TeleportPricing(
        new TeleportPrices(
            new TeleportPrice(0, Duration.ZERO, .5),
            price,
            new TeleportPrice(25, Duration.ofMinutes(1), 2),
            price,
            price,
            price),
        Duration.ofHours(1),
        4,
        32,
        Duration.ofDays(7));
  }

  Result<Quote, TeleportRefusal> charge(TeleportKind kind, Exemptions exemptions) {
    return charged(kind, exemptions).map(TeleportPayments.Charge::quote);
  }

  Result<TeleportPayments.Charge, TeleportRefusal> charged(
      TeleportKind kind, Exemptions exemptions) {
    return payments.charge(PLAYER, kind, exemptions).join();
  }

  /** A teleport that went through: charged, then confirmed on arrival. */
  Result<Quote, TeleportRefusal> pay(TeleportKind kind, Exemptions exemptions) {
    var result = charged(kind, exemptions);
    if (result instanceof Result.Ok<TeleportPayments.Charge, TeleportRefusal>(var payment)) {
      payments.confirm(PLAYER, payment).join();
    }
    return result.map(TeleportPayments.Charge::quote);
  }

  static Quote ok(Result<Quote, TeleportRefusal> result) {
    return result.fold(
        quote -> quote,
        error -> {
          throw new AssertionError(error);
        });
  }

  @Test
  void chargingRecordsNoUsageUntilConfirmed() {
    wallets.deposit(WALLET, 100);

    var charge =
        charged(TeleportKind.HOME, Exemptions.NONE)
            .fold(
                c -> c,
                e -> {
                  throw new AssertionError(e);
                });

    assertThat(wallets.balanceOf(WALLET)).isEqualTo(75);
    assertThat(usage.usage).isEmpty();
    payments.confirm(PLAYER, charge).join();
    assertThat(usage.usage).containsKey(PLAYER);
    assertThat(attempts.attempts).isEmpty();
  }

  @Test
  void aRefundedTeleportCostsNothingAndDoesNotEscalate() {
    wallets.deposit(WALLET, 100);

    var failed =
        charged(TeleportKind.HOME, Exemptions.NONE)
            .fold(
                c -> c,
                e -> {
                  throw new AssertionError(e);
                });
    payments.refund(failed).join();
    var retry = ok(charge(TeleportKind.HOME, Exemptions.NONE));

    assertThat(retry.cost()).isEqualTo(25);
    assertThat(retry.multiplier()).isEqualTo(Multiplier.ONE);
    assertThat(wallets.balanceOf(WALLET)).isEqualTo(75);
  }

  @Test
  void chargesThePlayerIntoTheServerAccountWithTheKindAsReason() {
    wallets.deposit(WALLET, 100);

    var paid = pay(TeleportKind.HOME, Exemptions.NONE);

    assertThat(paid.map(Quote::cost)).isEqualTo(Result.ok(25L));
    assertThat(wallets.balanceOf(WALLET)).isEqualTo(75);
    assertThat(wallets.receipts())
        .singleElement()
        .satisfies(
            receipt -> {
              assertThat(receipt.from()).isEqualTo(WALLET);
              assertThat(receipt.to()).isEqualTo(new AccountId.Server());
              assertThat(receipt.reason()).isEqualTo("teleport:home");
            });
    assertThat(usage.usage.get(PLAYER)).extracting(value -> value.trips().size()).isEqualTo(1);
  }

  @Test
  void theFifthNormalTeleportCostsMore() {
    wallets.deposit(WALLET, 500);
    for (var i = 0; i < 4; i++) {
      assertThat(pay(TeleportKind.HOME, Exemptions.NONE).map(Quote::cost))
          .isEqualTo(Result.ok(25L));
      clock.advance(Duration.ofMinutes(1));
    }
    assertThat(pay(TeleportKind.HOME, Exemptions.NONE).map(Quote::cost)).isEqualTo(Result.ok(50L));
    assertThat(wallets.balanceOf(WALLET)).isEqualTo(350);
  }

  @Test
  void insufficientFundsRefusesWithoutRecordingUsage() {
    wallets.deposit(WALLET, 24);

    var paid = pay(TeleportKind.HOME, Exemptions.NONE);

    assertThat(paid).isEqualTo(Result.err(new TeleportRefusal.CannotAfford(24, 25)));
    assertThat(wallets.balanceOf(WALLET)).isEqualTo(24);
    assertThat(wallets.receipts()).isEmpty();
    assertThat(usage.usage).isEmpty();
  }

  @Test
  void aCooldownRefusesBeforeAnyCharge() {
    wallets.deposit(WALLET, 100);
    pay(TeleportKind.HOME, Exemptions.NONE);
    clock.advance(Duration.ofSeconds(30));

    var paid = pay(TeleportKind.HOME, Exemptions.NONE);

    assertThat(paid)
        .isEqualTo(
            Result.err(
                new TeleportRefusal.Cooldown(
                    new OnCooldown(TeleportKind.HOME, Duration.ofSeconds(30)))));
    assertThat(wallets.receipts()).hasSize(1);
  }

  @Test
  void cooldownsAreSharedAcrossKinds() {
    wallets.deposit(WALLET, 100);
    pay(TeleportKind.HOME, Exemptions.NONE);

    assertThat(pay(TeleportKind.WARP, Exemptions.NONE))
        .isEqualTo(
            Result.err(
                new TeleportRefusal.Cooldown(
                    new OnCooldown(TeleportKind.WARP, Duration.ofMinutes(1)))));
  }

  @Test
  void freeTeleportsMoveNoCrystalsButStillCount() {
    var paid = pay(TeleportKind.SPAWN, Exemptions.NONE);
    var exempt = pay(TeleportKind.HOME, new Exemptions(true, false));

    assertThat(paid.map(Quote::cost)).isEqualTo(Result.ok(0L));
    assertThat(exempt.map(Quote::cost)).isEqualTo(Result.ok(0L));
    assertThat(wallets.receipts()).isEmpty();
    assertThat(usage.usage.get(PLAYER))
        .isNotNull()
        .extracting(value -> value.trips().size())
        .isEqualTo(2);
  }

  @Test
  void quotingDoesNotChargeOrRecord() {
    wallets.deposit(WALLET, 100);

    var quote = payments.quote(PLAYER, TeleportKind.HOME, Exemptions.NONE).join();

    assertThat(quote.map(Quote::cost)).isEqualTo(Result.ok(25L));
    assertThat(wallets.receipts()).isEmpty();
    assertThat(usage.usage).isEmpty();
  }

  @Test
  void refundsReturnTheCrystals() {
    wallets.deposit(WALLET, 100);
    var charge =
        charged(TeleportKind.HOME, Exemptions.NONE)
            .fold(
                q -> q,
                e -> {
                  throw new AssertionError(e);
                });

    payments.refund(charge).join();

    assertThat(wallets.balanceOf(WALLET)).isEqualTo(100);
    assertThat(wallets.receipts().getLast().reason()).isEqualTo("teleport:refund:home");
  }

  @Test
  void refundingAFreeTeleportDoesNothing() {
    var charge =
        charged(TeleportKind.SPAWN, Exemptions.NONE)
            .fold(
                q -> q,
                e -> {
                  throw new AssertionError(e);
                });

    payments.refund(charge).join();

    assertThat(wallets.receipts()).isEmpty();
  }

  @Test
  void startupRefundsACommittedChargeLeftWithoutArrivalConfirmation() {
    wallets.deposit(WALLET, 100);
    var charge =
        charged(TeleportKind.HOME, Exemptions.NONE)
            .fold(
                c -> c,
                e -> {
                  throw new AssertionError(e);
                });

    assertThat(wallets.balanceOf(WALLET)).isEqualTo(75);
    assertThat(attempts.attempts).containsKey(charge.attempt().orElseThrow().id());

    var recovered =
        new TeleportPayments(
            new TeleportPricer(pricing()),
            new TeleportPayments.Stores(usage, attempts),
            wallets,
            clock);
    recovered.loaded().join();
    var repeated =
        new TeleportPayments(
            new TeleportPricer(pricing()),
            new TeleportPayments.Stores(usage, attempts),
            wallets,
            clock);
    repeated.loaded().join();

    assertThat(wallets.balanceOf(WALLET)).isEqualTo(100);
    assertThat(wallets.receipts()).hasSize(2);
    assertThat(usage.usage).isEmpty();
    assertThat(attempts.attempts).isEmpty();
  }

  @Test
  void startupDiscardsAnObligationWithNoLedgerCharge() {
    var attempt = new TeleportAttempt(UUID.randomUUID(), PLAYER, TeleportKind.HOME, 25);
    attempts.attempts.put(attempt.id(), attempt);

    var recovered =
        new TeleportPayments(
            new TeleportPricer(pricing()),
            new TeleportPayments.Stores(usage, attempts),
            wallets,
            clock);
    recovered.loaded().join();

    assertThat(attempts.attempts).isEmpty();
    assertThat(wallets.receipts()).isEmpty();
  }
}
