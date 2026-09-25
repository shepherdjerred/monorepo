package com.shepherdjerred.thestorm.shops.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.shops.domain.catalog.Catalog;
import com.shepherdjerred.thestorm.shops.domain.catalog.CatalogEntry;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.time.Instant;
import java.time.InstantSource;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.slf4j.helpers.NOPLogger;

final class CatalogTradesTest {

  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00Z");
  private static final Customer ALICE = new Customer(new UUID(0, 1), "Alice");
  private static final CatalogEntry COAL =
      new CatalogEntry("coal", 16, Optional.of(48L), Optional.of(16L), OptionalInt.empty());
  private static final CatalogEntry EMERALD =
      new CatalogEntry("emerald", 1, Optional.empty(), Optional.of(12L), OptionalInt.of(4));
  private static final Catalog CATALOG =
      new Catalog("exchange", "Braxton's Exchange", "Hello.", List.of(COAL, EMERALD));

  private final FakeWallets wallets = new FakeWallets();
  private final FakeStore store = new FakeStore();
  private final ShopLocks locks = new ShopLocks();
  private final DailyUsage usage;
  private final CatalogTrades trades;

  CatalogTradesTest() {
    var time = InstantSource.fixed(NOW);
    var engine =
        new TradeEngine(
            wallets, Runnable::run, new RefundJournal(store, time, NOPLogger.NOP_LOGGER));
    var wiring =
        new ChestShops.Wiring(
            new ShopRegistry(List.of(), 0),
            store,
            locks,
            engine,
            Runnable::run,
            time,
            NOPLogger.NOP_LOGGER);
    usage = new DailyUsage(store, time, ZoneId.of("UTC"), Runnable::run);
    trades = new CatalogTrades(List.of(CATALOG), wiring, usage, 16);
  }

  private TradeOutcome trade(CatalogEntry entry, Direction direction, int lots, Holdings items)
      throws Exception {
    return trades
        .trade(new CatalogTrades.Order(CATALOG, entry, direction, lots, ALICE, items))
        .get();
  }

  @Test
  void findsCatalogsById() {
    assertThat(trades.catalog("exchange")).contains(CATALOG);
    assertThat(trades.catalog("nowhere")).isEmpty();
    assertThat(trades.ids()).containsExactly("exchange");
    assertThat(trades.maxLots()).isEqualTo(16);
  }

  @Test
  void buyingSeveralLotsPaysTheServerAndDeliversEverything() throws Exception {
    wallets.set(ALICE.account(), 200);
    var inventory = new FakeHoldings(0, 2304);

    var outcome = trade(COAL, Direction.BUY, 3, inventory);

    assertThat(outcome).isInstanceOf(TradeOutcome.Completed.class);
    assertThat(inventory.count).isEqualTo(48);
    assertThat(wallets.balanceOf(ALICE.account())).isEqualTo(56);
    assertThat(wallets.receipts().getFirst().to()).isEqualTo(new AccountId.Server());
    assertThat(wallets.receipts().getFirst().reason()).isEqualTo("shop:catalog:exchange:coal:buy");
    assertThat(store.trades)
        .singleElement()
        .satisfies(
            logged -> {
              assertThat(logged.trade())
                  .isEqualTo(
                      new TradeRecord(
                          new TradeSite.Catalog("exchange"),
                          ALICE.id(),
                          "Alice",
                          Direction.BUY,
                          "coal",
                          48,
                          144,
                          NOW));
              assertThat(logged.notified()).isTrue();
            });
  }

  @Test
  void sellingEmeraldsIsPaidByTheServer() throws Exception {
    var inventory = new FakeHoldings(10, 64);

    var outcome = trade(EMERALD, Direction.SELL, 4, inventory);

    assertThat(outcome).isInstanceOf(TradeOutcome.Completed.class);
    assertThat(inventory.count).isEqualTo(6);
    assertThat(wallets.balanceOf(ALICE.account())).isEqualTo(48);
  }

  @Test
  void theDailyLimitCountsEarlierTradesToday() throws Exception {
    var inventory = new FakeHoldings(10, 64);
    trade(EMERALD, Direction.SELL, 3, inventory);

    var outcome = trade(EMERALD, Direction.SELL, 2, inventory);

    assertThat(outcome)
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.DailyLimitReached(1, 2)));
    assertThat(inventory.count).isEqualTo(7);
    assertThat(trades.remainingToday(CATALOG, EMERALD, Direction.SELL, ALICE).get()).hasValue(1);
  }

  @Test
  void yesterdaysTradesDoNotCount() throws Exception {
    store.trades.add(
        new FakeStore.Logged(
            new TradeRecord(
                new TradeSite.Catalog("exchange"),
                ALICE.id(),
                "Alice",
                Direction.SELL,
                "emerald",
                4,
                48,
                Instant.parse("2026-09-24T23:59:59Z")),
            true));

    assertThat(trades.remainingToday(CATALOG, EMERALD, Direction.SELL, ALICE).get()).hasValue(4);
    assertThat(trade(EMERALD, Direction.SELL, 4, new FakeHoldings(4, 64)))
        .isInstanceOf(TradeOutcome.Completed.class);
  }

  @Test
  void entriesWithoutALimitHaveNoAllowance() throws Exception {
    assertThat(trades.remainingToday(CATALOG, COAL, Direction.BUY, ALICE).get()).isEmpty();
  }

  @Test
  void theCatalogOnlyTradesWhatItLists() throws Exception {
    assertThat(trade(EMERALD, Direction.BUY, 1, new FakeHoldings(0, 64)))
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.NotOffered(Direction.BUY)));
  }

  @Test
  void aCustomerWithATradeInFlightIsBusy() throws Exception {
    var lease = locks.acquire(List.of(), ALICE.id(), dummyDeal()).orElseThrow();

    assertThat(trade(COAL, Direction.SELL, 1, new FakeHoldings(16, 64)))
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.Busy()));

    lease.release();
    assertThat(trade(COAL, Direction.SELL, 1, new FakeHoldings(16, 64)))
        .isInstanceOf(TradeOutcome.Completed.class);
  }

  @Test
  void theLockIsReleasedAfterARefusal() throws Exception {
    trade(COAL, Direction.BUY, 1, new FakeHoldings(0, 64));

    assertThat(locks.idle()).isTrue();
  }

  @Test
  void lotsAreValidatedBeforeTrading() {
    assertThatThrownBy(() -> trade(COAL, Direction.BUY, 0, new FakeHoldings(0, 64)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> trade(COAL, Direction.BUY, 17, new FakeHoldings(0, 64)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void catalogIdsMustBeUnique() {
    var wiring =
        new ChestShops.Wiring(
            new ShopRegistry(List.of(), 0),
            store,
            locks,
            new TradeEngine(
                wallets,
                Runnable::run,
                new RefundJournal(store, InstantSource.fixed(NOW), NOPLogger.NOP_LOGGER)),
            Runnable::run,
            InstantSource.fixed(NOW),
            NOPLogger.NOP_LOGGER);

    assertThatThrownBy(() -> new CatalogTrades(List.of(CATALOG, CATALOG), wiring, usage, 1))
        .hasMessageContaining("exchange");
  }

  private static Deal dummyDeal() {
    return new Deal(
        Direction.BUY,
        1,
        Crystals.of(1),
        new Deal.Party(ALICE.account(), new FakeHoldings(0, 1)),
        new Deal.Party(new AccountId.Server(), Holdings.UNLIMITED),
        "test");
  }

  @Test
  void theDailyLimitIsCountedInMemoryNotReadBackFromTheLog() throws Exception {
    var inventory = new FakeHoldings(10, 64);
    trade(EMERALD, Direction.SELL, 3, inventory);
    // The log write for that trade has not landed yet.
    store.trades.clear();

    var outcome = trade(EMERALD, Direction.SELL, 2, inventory);

    assertThat(outcome)
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.DailyLimitReached(1, 2)));
    assertThat(store.usageReads).isEqualTo(1);
  }

  @Test
  void usageIsReadOncePerPlayerPerDayAndPreloadIsEnough() throws Exception {
    store.trades.add(
        new FakeStore.Logged(
            new TradeRecord(
                new TradeSite.Catalog("exchange"),
                ALICE.id(),
                "Alice",
                Direction.SELL,
                "emerald",
                4,
                48,
                NOW.minusSeconds(60)),
            true));

    usage.preload(ALICE.id()).get();

    assertThat(trades.remainingToday(CATALOG, EMERALD, Direction.SELL, ALICE).get()).hasValue(0);
    assertThat(trades.remainingToday(CATALOG, EMERALD, Direction.BUY, ALICE).get()).hasValue(4);
    assertThat(store.usageReads).isEqualTo(1);
  }

  @Test
  void entriesWithoutALimitAreCountedToo() throws Exception {
    wallets.set(ALICE.account(), 200);

    trade(COAL, Direction.BUY, 2, new FakeHoldings(0, 2304));

    assertThat(
            usage.used(ALICE.id(), new ShopStore.UsageKey("exchange", "coal", Direction.BUY)).get())
        .isEqualTo(32);
  }
}
