package com.shepherdjerred.thestorm.shops.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationProblem;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationRules;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopLimits;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.sign.ItemLine;
import com.shepherdjerred.thestorm.shops.domain.sign.OwnerLine;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignDraft;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.slf4j.helpers.NOPLogger;

final class ChestShopsTest {

  private static final UUID WORLD = new UUID(9, 9);
  private static final Customer ALICE = new Customer(new UUID(0, 1), "Alice");
  private static final Customer BOB = new Customer(new UUID(0, 2), "Bob");
  private static final ItemFingerprint COAL = new ItemFingerprint("coal", "Y29hbA==", false);
  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00Z");

  private final FakeWallets wallets = new FakeWallets();
  private final FakeStore store = new FakeStore();
  private final ShopRegistry registry = new ShopRegistry(List.of());
  private final ShopLocks locks = new ShopLocks();
  private final List<UUID> online = new ArrayList<>();
  private final ChestShops shops;

  ChestShopsTest() {
    var time = InstantSource.fixed(NOW);
    var engine =
        new TradeEngine(
            wallets, Runnable::run, new RefundJournal(store, time, NOPLogger.NOP_LOGGER));
    var wiring =
        new ChestShops.Wiring(
            registry, store, locks, engine, Runnable::run, time, NOPLogger.NOP_LOGGER);
    var limits = new ShopLimits(Map.of(1, 1, 2, 2, 3, 3, 4, 4, 5, 5));
    shops =
        new ChestShops(
            wiring, CreationRules.standard(limits), (owner, trade) -> online.contains(owner));
  }

  private static BlockPos at(int x) {
    return new BlockPos(WORLD, x, 64, 0);
  }

  private static ChestShops.Placement place(BlockPos sign, Optional<BlockPos> container) {
    return new ChestShops.Placement(sign, container, container.stream().toList());
  }

  private static ChestShops.Request request(
      Customer creator, OwnerLine owner, int level, ChestShops.Placement where) {
    return new ChestShops.Request(
        new ShopSignDraft(owner, 16, ShopPrices.both(50, 40), new ItemLine.Named("coal")),
        creator,
        owner instanceof OwnerLine.AdminShop,
        level,
        where,
        Optional.of(COAL));
  }

  private SignShop create(Customer creator, int x) {
    return created(
        shops.create(
            request(creator, new OwnerLine.Creator(), 1, place(at(x), Optional.of(at(x + 100))))));
  }

  private static SignShop created(Result<SignShop, List<CreationProblem>> result) {
    return result.fold(
        shop -> shop,
        problems -> {
          throw new AssertionError(problems.toString());
        });
  }

  @Test
  void aShopkeeperMakesAShopThatIsRegisteredAndSaved() {
    var shop = create(ALICE, 0);

    assertThat(shop.id()).isEqualTo(1);
    assertThat(shop.owner()).isEqualTo(new ShopOwner.Player(ALICE.id(), "Alice"));
    assertThat(shop.item()).contains(COAL);
    assertThat(shop.createdAt()).isEqualTo(NOW);
    assertThat(registry.atSign(at(0))).contains(shop);
    assertThat(registry.tradingFrom(at(100))).containsExactly(shop);
    assertThat(store.shops).containsKey(1L);
  }

  @Test
  void theLimitCountsTheShopsAlreadyOwned() {
    create(ALICE, 0);

    var second =
        shops.create(
            request(ALICE, new OwnerLine.Creator(), 1, place(at(1), Optional.of(at(101)))));

    assertThat(second).isEqualTo(Result.err(List.of(new CreationProblem.LimitReached(1))));
    assertThat(registry.ownedBy(ALICE.id())).isEqualTo(1);
  }

  @Test
  void aContainerTradingForSomeoneElseIsTaken() {
    create(ALICE, 0);

    var onAlicesChest =
        shops.create(request(BOB, new OwnerLine.Creator(), 1, place(at(1), Optional.of(at(100)))));

    assertThat(onAlicesChest).isEqualTo(Result.err(List.of(new CreationProblem.ContainerTaken())));
  }

  @Test
  void anOwnerMayPutSeveralSignsOnOneContainer() {
    create(ALICE, 0);

    var second =
        shops.create(
            request(ALICE, new OwnerLine.Creator(), 2, place(at(1), Optional.of(at(100)))));

    assertThat(second.isOk()).isTrue();
    assertThat(registry.tradingFrom(at(100))).hasSize(2);
  }

  @Test
  void aChestShopNeedsAContainerButAnAdminShopDoesNot() {
    assertThat(
            shops.create(
                request(ALICE, new OwnerLine.Creator(), 1, place(at(0), Optional.empty()))))
        .isEqualTo(Result.err(List.of(new CreationProblem.NoContainer())));

    var admin =
        shops.create(request(ALICE, new OwnerLine.AdminShop(), 0, place(at(0), Optional.empty())));

    assertThat(admin.map(SignShop::owner)).isEqualTo(Result.ok(new ShopOwner.Admin()));
    assertThat(registry.ownedBy(ALICE.id())).isZero();
  }

  @Test
  void anAdminShopCannotShareAPlayersContainer() {
    create(ALICE, 0);

    var admin =
        shops.create(
            request(BOB, new OwnerLine.AdminShop(), 0, place(at(1), Optional.of(at(100)))));

    assertThat(admin).isEqualTo(Result.err(List.of(new CreationProblem.ContainerTaken())));
  }

  @Test
  void aShopThatCannotBeSavedIsForgotten() {
    store.failSaves = true;

    create(ALICE, 0);

    assertThat(registry.atSign(at(0))).isEmpty();
  }

  @Test
  void settingTheItemOfAPendingShop() {
    var pending =
        created(
            shops.create(
                new ChestShops.Request(
                    new ShopSignDraft(
                        new OwnerLine.Creator(), 1, ShopPrices.buyOnly(5), new ItemLine.Pending()),
                    ALICE,
                    false,
                    1,
                    new ChestShops.Placement(at(0), Optional.of(at(100)), List.of(at(100))),
                    Optional.empty())));

    var updated = shops.setItem(pending, COAL);

    assertThat(updated.item()).contains(COAL);
    assertThat(registry.byId(pending.id())).contains(updated);
    assertThat(store.shops)
        .extractingByKey(pending.id())
        .extracting(SignShop::item)
        .isEqualTo(Optional.of(COAL));
    assertThatThrownBy(() -> shops.setItem(updated, COAL))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void removingAShopForgetsIt() {
    var shop = create(ALICE, 0);

    shops.remove(shop);

    assertThat(registry.atSign(at(0))).isEmpty();
    assertThat(registry.tradingFrom(at(100))).isEmpty();
    assertThat(store.shops).isEmpty();
  }

  private TradeOutcome trade(SignShop shop, Direction direction, Customer customer, Holdings items)
      throws Exception {
    return shops
        .trade(new ChestShops.Visit(shop, direction, customer, items, new FakeHoldings(32, 64)))
        .get();
  }

  @Test
  void aCompletedTradeIsLoggedAndTheOnlineOwnerTold() throws Exception {
    var shop = create(ALICE, 0);
    online.add(ALICE.id());
    wallets.set(BOB.account(), 50);

    var outcome = trade(shop, Direction.BUY, BOB, new FakeHoldings(0, 64));

    assertThat(outcome).isInstanceOf(TradeOutcome.Completed.class);
    assertThat(wallets.balanceOf(new AccountId.Player(ALICE.id()))).isEqualTo(50);
    assertThat(store.trades)
        .singleElement()
        .satisfies(
            logged -> {
              assertThat(logged.notified()).isTrue();
              assertThat(logged.trade().site()).isEqualTo(new TradeSite.Chest(1, ALICE.id()));
              assertThat(logged.trade().customerName()).isEqualTo("Bob");
              assertThat(logged.trade().material()).isEqualTo("coal");
              assertThat(logged.trade().quantity()).isEqualTo(16);
              assertThat(logged.trade().price()).isEqualTo(50);
              assertThat(logged.trade().at()).isEqualTo(NOW);
            });
    assertThat(locks.isBusy(shop.id())).isFalse();
  }

  @Test
  void anOfflineOwnerHearsAboutItLater() throws Exception {
    var shop = create(ALICE, 0);
    wallets.set(new AccountId.Player(ALICE.id()), 100);

    trade(shop, Direction.SELL, BOB, new FakeHoldings(16, 64));

    assertThat(store.trades)
        .singleElement()
        .satisfies(logged -> assertThat(logged.notified()).isFalse());
    assertThat(store.takeUnnotified(ALICE.id()).get()).hasSize(1);
    assertThat(store.takeUnnotified(ALICE.id()).get()).isEmpty();
  }

  @Test
  void refusedTradesAreNotLogged() throws Exception {
    var shop = create(ALICE, 0);

    var outcome = trade(shop, Direction.BUY, BOB, new FakeHoldings(0, 64));

    assertThat(outcome)
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.CustomerCannotPay(0, 50)));
    assertThat(store.trades).isEmpty();
  }

  @Test
  void ownersCannotTradeWithTheirOwnShop() throws Exception {
    var shop = create(ALICE, 0);

    assertThat(trade(shop, Direction.BUY, ALICE, new FakeHoldings(0, 64)))
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.OwnShop()));
  }

  @Test
  void aShopWithoutItsItemOrAPriceRefuses() throws Exception {
    var shop = create(ALICE, 0);
    var pending =
        new SignShop(
            shop.id(),
            shop.sign(),
            shop.container(),
            shop.owner(),
            1,
            ShopPrices.buyOnly(5),
            Optional.empty(),
            NOW);

    assertThat(trade(pending, Direction.BUY, BOB, new FakeHoldings(0, 64)))
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.ItemNotSet()));
    assertThat(trade(pending.withItem(COAL), Direction.SELL, BOB, new FakeHoldings(9, 64)))
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.NotOffered(Direction.SELL)));
  }

  @Test
  void aShopWithATradeInFlightIsBusy() throws Exception {
    var shop = create(ALICE, 0);
    var lease = locks.acquire(OptionalLong.of(shop.id()), new UUID(0, 99)).orElseThrow();

    assertThat(trade(shop, Direction.BUY, BOB, new FakeHoldings(0, 64)))
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.Busy()));

    lease.release();
    wallets.set(BOB.account(), 50);
    assertThat(trade(shop, Direction.BUY, BOB, new FakeHoldings(0, 64)))
        .isInstanceOf(TradeOutcome.Completed.class);
  }

  @Test
  void adminShopTradesAreLoggedAsAdmin() throws Exception {
    var admin =
        created(
            shops.create(
                request(ALICE, new OwnerLine.AdminShop(), 0, place(at(5), Optional.empty()))));
    wallets.set(BOB.account(), 50);

    var outcome =
        shops
            .trade(
                new ChestShops.Visit(
                    admin, Direction.BUY, BOB, new FakeHoldings(0, 64), Holdings.UNLIMITED))
            .get();

    assertThat(outcome).isInstanceOf(TradeOutcome.Completed.class);
    assertThat(store.trades.getFirst().trade().site()).isEqualTo(new TradeSite.Admin(admin.id()));
    assertThat(store.trades.getFirst().notified()).isTrue();
    assertThat(ChestShops.accountOf(admin.owner())).isEqualTo(new AccountId.Server());
  }
}
