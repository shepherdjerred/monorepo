package com.shepherdjerred.thestorm.essentials.app;

import static java.util.concurrent.CompletableFuture.completedFuture;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.essentials.app.store.TeleportUsageStore;
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
import java.util.HashMap;
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
    final Map<TeleportKind, TeleportUsage> usage = new HashMap<>();

    @Override
    public CompletableFuture<Optional<TeleportUsage>> find(UUID player, TeleportKind kind) {
      return completedFuture(Optional.ofNullable(usage.get(kind)));
    }

    @Override
    public CompletableFuture<Void> save(UUID player, TeleportKind kind, TeleportUsage next) {
      usage.put(kind, next);
      return completedFuture(null);
    }
  }

  final FakeClock clock = FakeClock.at("2026-09-25T12:00:00Z");
  final FakeWallets wallets = new FakeWallets();
  final MemoryUsage usage = new MemoryUsage();
  final TeleportPayments payments =
      new TeleportPayments(new TeleportPricer(pricing()), usage, wallets, clock);

  static TeleportPricing pricing() {
    var price = new TeleportPrice(25, Duration.ofMinutes(1));
    return new TeleportPricing(
        new TeleportPrices(new TeleportPrice(0, Duration.ZERO), price, price, price, price),
        0.5,
        0.5,
        Duration.ofMinutes(10),
        4);
  }

  Result<Quote, TeleportRefusal> charge(TeleportKind kind, Exemptions exemptions) {
    return payments.charge(PLAYER, kind, exemptions).join();
  }

  /** A teleport that went through: charged, then confirmed on arrival. */
  Result<Quote, TeleportRefusal> pay(TeleportKind kind, Exemptions exemptions) {
    var charged = charge(kind, exemptions);
    if (charged instanceof Result.Ok<Quote, TeleportRefusal>(var quote)) {
      payments.confirm(PLAYER, quote).join();
    }
    return charged;
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

    var quote = ok(charge(TeleportKind.HOME, Exemptions.NONE));

    assertThat(wallets.balanceOf(WALLET)).isEqualTo(75);
    assertThat(usage.usage).isEmpty();
    payments.confirm(PLAYER, quote).join();
    assertThat(usage.usage).containsKey(TeleportKind.HOME);
  }

  @Test
  void aRefundedTeleportCostsNothingAndDoesNotEscalate() {
    wallets.deposit(WALLET, 100);

    var failed = ok(charge(TeleportKind.HOME, Exemptions.NONE));
    payments.refund(PLAYER, failed).join();
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
    assertThat(usage.usage.get(TeleportKind.HOME))
        .extracting(TeleportUsage::multiplier)
        .isEqualTo(Multiplier.of(1.5));
  }

  @Test
  void theSecondTeleportCostsMore() {
    wallets.deposit(WALLET, 100);
    pay(TeleportKind.HOME, Exemptions.NONE);
    clock.advance(Duration.ofMinutes(1));

    assertThat(pay(TeleportKind.HOME, Exemptions.NONE).map(Quote::cost)).isEqualTo(Result.ok(38L));
    assertThat(wallets.balanceOf(WALLET)).isEqualTo(37);
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
  void cooldownsArePerKind() {
    wallets.deposit(WALLET, 100);
    pay(TeleportKind.HOME, Exemptions.NONE);

    assertThat(pay(TeleportKind.WARP, Exemptions.NONE).isOk()).isTrue();
  }

  @Test
  void freeTeleportsMoveNoCrystalsButStillCount() {
    var paid = pay(TeleportKind.SPAWN, Exemptions.NONE);
    var exempt = pay(TeleportKind.HOME, new Exemptions(true, false));

    assertThat(paid.map(Quote::cost)).isEqualTo(Result.ok(0L));
    assertThat(exempt.map(Quote::cost)).isEqualTo(Result.ok(0L));
    assertThat(wallets.receipts()).isEmpty();
    assertThat(usage.usage).containsKeys(TeleportKind.SPAWN, TeleportKind.HOME);
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
    var quote =
        pay(TeleportKind.HOME, Exemptions.NONE)
            .fold(
                q -> q,
                e -> {
                  throw new AssertionError(e);
                });

    payments.refund(PLAYER, quote).join();

    assertThat(wallets.balanceOf(WALLET)).isEqualTo(100);
    assertThat(wallets.receipts().getLast().reason()).isEqualTo("teleport:refund:home");
  }

  @Test
  void refundingAFreeTeleportDoesNothing() {
    var quote =
        pay(TeleportKind.SPAWN, Exemptions.NONE)
            .fold(
                q -> q,
                e -> {
                  throw new AssertionError(e);
                });

    payments.refund(PLAYER, quote).join();

    assertThat(wallets.receipts()).isEmpty();
  }
}
