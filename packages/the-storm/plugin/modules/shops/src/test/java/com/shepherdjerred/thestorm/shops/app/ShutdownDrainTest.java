package com.shepherdjerred.thestorm.shops.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationRules;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopLimits;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;
import org.slf4j.helpers.NOPLogger;

/** Trades in flight when the module stops, with a scheduler that no longer runs tasks. */
final class ShutdownDrainTest {

  private static final UUID WORLD = new UUID(9, 9);
  private static final UUID ALICE = new UUID(0, 1);
  private static final Customer BOB = new Customer(new UUID(0, 2), "Bob");
  private static final BlockPos CHEST = new BlockPos(WORLD, 0, 64, 0);

  private final FakeWallets wallets = new FakeWallets();
  private final FakeStore store = new FakeStore();
  private final ShopLocks locks = new ShopLocks();
  // The plugin is disabling: the scheduler drops every task, so only the drain runs them.
  private final MainThreadPump pump = new MainThreadPump(task -> {});
  private final RefundJournal journal =
      new RefundJournal(store, InstantSource.fixed(Instant.EPOCH), NOPLogger.NOP_LOGGER);
  private final ShutdownDrain drain = new ShutdownDrain(pump, locks, journal);
  private final FakeHoldings bobsItems = new FakeHoldings(0, 64);
  private final FakeHoldings chest = new FakeHoldings(32, 64);

  private CompletableFuture<TradeOutcome> bobBuys() {
    var registry = new ShopRegistry(List.of(), 0);
    var time = InstantSource.fixed(Instant.EPOCH);
    var wiring =
        new ChestShops.Wiring(
            registry,
            store,
            locks,
            new TradeEngine(wallets, pump, journal),
            pump,
            time,
            NOPLogger.NOP_LOGGER);
    var shops =
        new ChestShops(
            wiring,
            new ChestShops.Policy(
                CreationRules.standard(new ShopLimits(Map.of(1, 1, 2, 2, 3, 3, 4, 4, 5, 5))),
                new ServerOffers(List.of(), registry),
                Duration.ZERO),
            new ShopEffects() {
              @Override
              public boolean tellOwnerIfOnline(UUID owner, TradeRecord trade) {
                return false;
              }

              @Override
              public void closeViewers(List<BlockPos> containerBlocks) {}
            });
    var shop =
        new SignShop(
            1,
            new BlockPos(WORLD, 0, 64, 1),
            Optional.of(CHEST),
            new ShopOwner.Player(ALICE, "Alice"),
            16,
            ShopPrices.buyOnly(50),
            Optional.of(new ItemFingerprint("coal", "Y29hbA==", false)),
            Instant.EPOCH);
    wallets.set(BOB.account(), 100);
    wallets.holdNext();
    var trade =
        shops.trade(
            new ChestShops.Visit(shop, Direction.BUY, BOB, bobsItems, chest, List.of(CHEST)));
    // While the server still ran, the affordability answer came back and the trade was locked and
    // paid for; the ledger's answer to the payment is what is still outstanding.
    pump.runQueued();
    assertThat(locks.idle()).isFalse();
    return trade;
  }

  @Test
  void aTradeWhoseAnswerArrivedSettlesDuringTheDrain() throws Exception {
    var trade = bobBuys();
    wallets.answerHeld();
    assertThat(trade).isNotDone();

    var unsettled = drain.drain(Duration.ofSeconds(5));

    assertThat(unsettled).isZero();
    assertThat(trade.get()).isInstanceOf(TradeOutcome.Completed.class);
    assertThat(bobsItems.count).isEqualTo(16);
    assertThat(chest.count).isEqualTo(16);
    assertThat(locks.idle()).isTrue();
    assertThat(store.refundFailures).isEmpty();
  }

  @Test
  void aTradeStillWaitingOnTheLedgerIsLoggedForStaff() {
    var trade = bobBuys();

    var unsettled = drain.drain(Duration.ofMillis(50));

    assertThat(unsettled).isEqualTo(1);
    assertThat(trade).isNotDone();
    assertThat(locks.idle()).isTrue();
    assertThat(bobsItems.count).isZero();
    assertThat(store.refundFailures)
        .singleElement()
        .satisfies(
            failure -> {
              assertThat(failure.payer()).isEqualTo(BOB.account());
              assertThat(failure.payee()).isEqualTo(new AccountId.Player(ALICE));
              assertThat(failure.reason())
                  .startsWith("unsettled at shutdown: shop:1:buy")
                  .contains("whether the payment committed is unknown");
            });
  }
}
