package com.shepherdjerred.thestorm.shops.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.shops.domain.catalog.Catalog;
import com.shepherdjerred.thestorm.shops.domain.catalog.CatalogEntry;
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
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
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
  private static final Catalog REYNOLDS =
      new Catalog(
          "reynolds-supplies",
          "Reynold's Supplies",
          "Hello.",
          List.of(
              new CatalogEntry(
                  "coal", 16, Optional.of(48L), Optional.of(16L), OptionalInt.empty())));

  private final FakeStore store = new FakeStore();
  private final ShopRegistry registry = new ShopRegistry(List.of(), 0);
  private final ShopLocks locks = new ShopLocks();
  private final List<UUID> online = new ArrayList<>();
  private final List<List<BlockPos>> closed = new ArrayList<>();
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
    var effects =
        new ShopEffects() {
          @Override
          public boolean tellOwnerIfOnline(UUID owner, TradeRecord trade) {
            return online.contains(owner);
          }

          @Override
          public void closeViewers(List<BlockPos> containerBlocks) {
            closed.add(containerBlocks);
          }
        };
    shops =
        new ChestShops(
            wiring,
            new ChestShops.Policy(
                CreationRules.standard(limits),
                new ServerOffers(List.of(REYNOLDS), registry),
                Duration.ZERO),
            effects);
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

    var updated =
        shops
            .setItem(pending, COAL)
            .fold(
                shop -> shop,
                problem -> {
                  throw new AssertionError(problem.toString());
                });

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
        .trade(
            new ChestShops.Visit(
                shop,
                direction,
                customer,
                items,
                new FakeHoldings(32, 64),
                shop.container().stream().toList()))
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
    assertThat(locks.idle()).isTrue();
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
    var lease =
        locks
            .acquire(shop.container().stream().toList(), new UUID(0, 99), dummyDeal())
            .orElseThrow();
    wallets.set(BOB.account(), 50);

    assertThat(trade(shop, Direction.BUY, BOB, new FakeHoldings(0, 64)))
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.Busy()));

    lease.release();
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
                    admin,
                    Direction.BUY,
                    BOB,
                    new FakeHoldings(0, 64),
                    Holdings.UNLIMITED,
                    List.of()))
            .get();

    assertThat(outcome).isInstanceOf(TradeOutcome.Completed.class);
    assertThat(store.trades.getFirst().trade().site()).isEqualTo(new TradeSite.Admin(admin.id()));
    assertThat(store.trades.getFirst().notified()).isTrue();
    assertThat(ChestShops.accountOf(admin.owner())).isEqualTo(new AccountId.Server());
  }

  private Deal dummyDeal() {
    return new Deal(
        Direction.BUY,
        1,
        Crystals.of(1),
        new Deal.Party(BOB.account(), new FakeHoldings(0, 1)),
        new Deal.Party(new AccountId.Server(), Holdings.UNLIMITED),
        "test",
        "coal");
  }

  private SignShop secondSignOnTheSameChest(SignShop first) {
    return created(
        shops.create(request(ALICE, new OwnerLine.Creator(), 2, place(at(1), first.container()))));
  }

  @Test
  void twoSignsOnOneContainerTradeOneAtATime() throws Exception {
    var first = create(ALICE, 0);
    var second = secondSignOnTheSameChest(first);
    var carol = new Customer(new UUID(0, 3), "Carol");
    wallets.set(new AccountId.Player(ALICE.id()), 1000);
    var chest = new FakeHoldings(0, 32);
    wallets.holdNext();

    var bobs =
        shops.trade(
            new ChestShops.Visit(
                first,
                Direction.SELL,
                BOB,
                new FakeHoldings(16, 64),
                chest,
                List.of(at(100), at(101))));
    var carols =
        shops.trade(
            new ChestShops.Visit(
                second,
                Direction.SELL,
                carol,
                new FakeHoldings(16, 64),
                chest,
                List.of(at(101), at(100))));

    assertThat(carols.get()).isEqualTo(new TradeOutcome.Refused(new TradeProblem.Busy()));
    assertThat(bobs).isNotDone();
    assertThat(closed).containsExactly(List.of(at(100), at(101)));
    wallets.answerHeld();
    assertThat(bobs.get()).isInstanceOf(TradeOutcome.Completed.class);
    assertThat(chest.count).isEqualTo(16);
    assertThat(locks.idle()).isTrue();
  }

  @Test
  void aSecondSellerIntoAFullChestIsRefusedBeforeAnyMoneyMoves() throws Exception {
    var first = create(ALICE, 0);
    var second = secondSignOnTheSameChest(first);
    var carol = new Customer(new UUID(0, 3), "Carol");
    wallets.set(new AccountId.Player(ALICE.id()), 1000);
    var chest = new FakeHoldings(0, 16);
    var carolsItems = new FakeHoldings(16, 64);

    shops
        .trade(
            new ChestShops.Visit(
                first, Direction.SELL, BOB, new FakeHoldings(16, 64), chest, List.of(at(100))))
        .get();
    // Carol drains her wallet with /pay; nothing she does can leave her with both.
    wallets.set(carol.account(), 0);
    var outcome =
        shops
            .trade(
                new ChestShops.Visit(
                    second, Direction.SELL, carol, carolsItems, chest, List.of(at(100))))
            .get();

    assertThat(outcome).isEqualTo(new TradeOutcome.Refused(new TradeProblem.ShopFull(0, 16)));
    assertThat(carolsItems.count).isEqualTo(16);
    assertThat(wallets.balanceOf(carol.account())).isZero();
  }

  @Test
  void theLockIsReleasedOnTheMainThreadEvenWhenTheTradeFails() {
    var queued = new ArrayList<Runnable>();
    var time = InstantSource.fixed(NOW);
    var mainThread = (java.util.concurrent.Executor) queued::add;
    var engine =
        new TradeEngine(wallets, mainThread, new RefundJournal(store, time, NOPLogger.NOP_LOGGER));
    var wiring =
        new ChestShops.Wiring(
            registry, store, locks, engine, mainThread, time, NOPLogger.NOP_LOGGER);
    var slow =
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
    var shop = create(ALICE, 0);
    wallets.set(BOB.account(), 100);
    wallets.failNext(new IllegalStateException("database down"));

    var trade =
        slow.trade(
            new ChestShops.Visit(
                shop,
                Direction.BUY,
                BOB,
                new FakeHoldings(0, 64),
                new FakeHoldings(16, 64),
                List.of(at(100))));

    // The affordability answer is the first main-thread task; running it locks and pays.
    queued.removeFirst().run();
    assertThat(locks.isBusy(at(100))).isTrue();
    while (!queued.isEmpty()) {
      queued.removeFirst().run();
    }
    assertThat(locks.isBusy(at(100))).isFalse();
    assertThat(trade).isCompletedExceptionally();
  }

  @Test
  void anAdminShopMayNotPayMoreThanACatalogCharges() {
    // Reynold's sells coal at 3 crystals each; an admin shop paying 60 per 16 would pay 3.75.
    var request =
        new ChestShops.Request(
            new ShopSignDraft(
                new OwnerLine.AdminShop(), 16, ShopPrices.sellOnly(60), new ItemLine.Named("coal")),
            ALICE,
            true,
            0,
            place(at(7), Optional.empty()),
            Optional.of(COAL));

    assertThat(shops.create(request))
        .isEqualTo(Result.err(List.of(new CreationProblem.PriceLoop("Reynold's Supplies"))));
  }

  @Test
  void anAdminShopMayNotChargeLessThanAnotherAdminShopPays() {
    created(
        shops.create(
            new ChestShops.Request(
                new ShopSignDraft(
                    new OwnerLine.AdminShop(), 1, ShopPrices.sellOnly(10), new ItemLine.Pending()),
                ALICE,
                true,
                0,
                place(at(7), Optional.empty()),
                Optional.of(new ItemFingerprint("emerald", "ZW1lcmFsZA==", false)))));
    var pending =
        created(
            shops.create(
                new ChestShops.Request(
                    new ShopSignDraft(
                        new OwnerLine.AdminShop(),
                        4,
                        ShopPrices.buyOnly(36),
                        new ItemLine.Pending()),
                    ALICE,
                    true,
                    0,
                    place(at(8), Optional.empty()),
                    Optional.empty())));

    var set = shops.setItem(pending, new ItemFingerprint("emerald", "ZW1lcmFsZA==", false));

    assertThat(set).isEqualTo(Result.err(new CreationProblem.PriceLoop("another admin shop")));
    assertThat(registry.byId(pending.id()).orElseThrow().item()).isEmpty();
  }

  @Test
  void specialItemsAreComparedOnlyWithTheSameVariant() {
    var sharp = new ItemFingerprint("coal", "c3BlY2lhbA==", true);
    var request =
        new ChestShops.Request(
            new ShopSignDraft(
                new OwnerLine.AdminShop(), 16, ShopPrices.sellOnly(60), new ItemLine.Pending()),
            ALICE,
            true,
            0,
            place(at(7), Optional.empty()),
            Optional.of(sharp));

    assertThat(shops.create(request).isOk()).isTrue();
  }

  @Test
  void idsContinueAfterTheHighestEverIssued() {
    var restarted = new ShopRegistry(List.of(), 41);

    assertThat(restarted.nextId()).isEqualTo(42);
  }

  private ChestShops shopsWith(List<Catalog> catalogs, Duration cooldown, InstantSource clock) {
    var engine =
        new TradeEngine(
            wallets, Runnable::run, new RefundJournal(store, clock, NOPLogger.NOP_LOGGER));
    var wiring =
        new ChestShops.Wiring(
            registry, store, locks, engine, Runnable::run, clock, NOPLogger.NOP_LOGGER);
    return new ChestShops(
        wiring,
        new ChestShops.Policy(
            CreationRules.standard(new ShopLimits(Map.of(1, 1, 2, 2, 3, 3, 4, 4, 5, 5))),
            new ServerOffers(catalogs, registry),
            cooldown),
        new ShopEffects() {
          @Override
          public boolean tellOwnerIfOnline(UUID owner, TradeRecord trade) {
            return false;
          }

          @Override
          public void closeViewers(List<BlockPos> containerBlocks) {
            closed.add(containerBlocks);
          }
        });
  }

  private TradeOutcome click(ChestShops at, SignShop shop, Direction direction, Holdings items)
      throws Exception {
    return at.trade(
            new ChestShops.Visit(
                shop, direction, BOB, items, new FakeHoldings(0, 64), List.of(at(100))))
        .get();
  }

  @Test
  void twentyRefusedClicksNeverLockTheShopOrCloseTheOwnersView() throws Exception {
    var shop = create(ALICE, 0);
    wallets.set(BOB.account(), 0);
    for (var click = 0; click < 20; click++) {
      // An empty chest, empty hands, an empty wallet: every click is refused.
      var direction = click % 2 == 0 ? Direction.BUY : Direction.SELL;
      var outcome = click(shops, shop, direction, new FakeHoldings(0, 64));

      assertThat(outcome).isInstanceOf(TradeOutcome.Refused.class);
      assertThat(locks.idle()).isTrue();
    }
    assertThat(closed).isEmpty();
  }

  @Test
  void aBrokeBuyerAtAStockedShopIsRefusedBeforeTheLock() throws Exception {
    var shop = create(ALICE, 0);
    wallets.set(BOB.account(), 49);

    var outcome =
        shops
            .trade(
                new ChestShops.Visit(
                    shop,
                    Direction.BUY,
                    BOB,
                    new FakeHoldings(0, 64),
                    new FakeHoldings(64, 64),
                    List.of(at(100))))
            .get();

    assertThat(outcome)
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.CustomerCannotPay(49, 50)));
    assertThat(closed).isEmpty();
    assertThat(wallets.receipts()).isEmpty();
  }

  @Test
  void onlyATradeThatSettlesStartsTheCooldown() throws Exception {
    var now = new Instant[] {NOW};
    InstantSource clock = () -> now[0];
    var cooled = shopsWith(List.of(), Duration.ofMillis(150), clock);
    var shop = create(ALICE, 0);
    wallets.set(new AccountId.Player(ALICE.id()), 1000);

    // Refused clicks never start the wait.
    var refused = click(cooled, shop, Direction.SELL, new FakeHoldings(0, 64));
    now[0] = NOW.plusMillis(50);
    var sold = click(cooled, shop, Direction.SELL, new FakeHoldings(16, 64));
    now[0] = NOW.plusMillis(100);
    var tooSoon = click(cooled, shop, Direction.SELL, new FakeHoldings(16, 64));
    // Holding the use button repeats every 200 ms, which is past the 150 ms cooldown.
    now[0] = NOW.plusMillis(250);
    var held = click(cooled, shop, Direction.SELL, new FakeHoldings(16, 64));

    assertThat(refused).isEqualTo(new TradeOutcome.Refused(new TradeProblem.NotEnoughItems(0, 16)));
    assertThat(sold).isInstanceOf(TradeOutcome.Completed.class);
    assertThat(tooSoon).isEqualTo(new TradeOutcome.Refused(new TradeProblem.TooFast()));
    assertThat(held).isInstanceOf(TradeOutcome.Completed.class);
  }

  @Test
  void aCustomerWhoLeftIsForgotten() throws Exception {
    var cooled = shopsWith(List.of(), Duration.ofMinutes(1), InstantSource.fixed(NOW));
    var shop = create(ALICE, 0);
    wallets.set(new AccountId.Player(ALICE.id()), 1000);
    click(cooled, shop, Direction.SELL, new FakeHoldings(16, 64));
    assertThat(click(cooled, shop, Direction.SELL, new FakeHoldings(16, 64)))
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.TooFast()));

    cooled.forget(BOB.id());

    assertThat(click(cooled, shop, Direction.SELL, new FakeHoldings(16, 64)))
        .isInstanceOf(TradeOutcome.Completed.class);
  }

  @Test
  void aShopRemovedOrClosedBeforeTheLockIsRefusedWithoutTouchingAnything() {
    var queued = new ArrayList<Runnable>();
    var time = InstantSource.fixed(NOW);
    java.util.concurrent.Executor mainThread = queued::add;
    var engine =
        new TradeEngine(wallets, mainThread, new RefundJournal(store, time, NOPLogger.NOP_LOGGER));
    var slow =
        new ChestShops(
            new ChestShops.Wiring(
                registry, store, locks, engine, mainThread, time, NOPLogger.NOP_LOGGER),
            new ChestShops.Policy(
                CreationRules.standard(new ShopLimits(Map.of(1, 2, 2, 2, 3, 3, 4, 4, 5, 5))),
                new ServerOffers(List.of(), registry),
                Duration.ZERO),
            new ShopEffects() {
              @Override
              public boolean tellOwnerIfOnline(UUID owner, TradeRecord trade) {
                return false;
              }

              @Override
              public void closeViewers(List<BlockPos> containerBlocks) {
                closed.add(containerBlocks);
              }
            });
    var removed = create(ALICE, 0);
    var closedShop = create(BOB, 3);
    wallets.set(BOB.account(), 1000);
    wallets.set(new AccountId.Player(new UUID(0, 5)), 1000);
    var bobsItems = new FakeHoldings(0, 64);

    var first =
        slow.trade(
            new ChestShops.Visit(
                removed,
                Direction.BUY,
                BOB,
                bobsItems,
                new FakeHoldings(64, 64),
                List.of(at(100))));
    var second =
        slow.trade(
            new ChestShops.Visit(
                closedShop,
                Direction.BUY,
                new Customer(new UUID(0, 5), "Dan"),
                new FakeHoldings(0, 64),
                new FakeHoldings(64, 64),
                List.of(at(103))));
    // While the affordability checks were out, one shop was broken and the other closed.
    registry.remove(removed.id());
    registry.close(closedShop.id(), "an admin closed it.");
    while (!queued.isEmpty()) {
      queued.removeFirst().run();
    }

    assertThat(first.join())
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.ShopClosed("it was just removed.")));
    assertThat(second.join())
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.ShopClosed("an admin closed it.")));
    assertThat(closed).isEmpty();
    assertThat(locks.idle()).isTrue();
    assertThat(wallets.receipts()).isEmpty();
    assertThat(bobsItems.count).isZero();
  }

  @Test
  void aLedgerThatThrowsReleasesTheLockAndReturnsTheEscrow() {
    var shop = create(ALICE, 0);
    wallets.set(new AccountId.Player(ALICE.id()), 100);
    wallets.throwNext(new IllegalStateException("ledger broke"));
    var bobsItems = new FakeHoldings(16, 64);

    var trade =
        shops.trade(
            new ChestShops.Visit(
                shop, Direction.SELL, BOB, bobsItems, new FakeHoldings(0, 64), List.of(at(100))));

    assertThatThrownBy(trade::get).hasRootCauseMessage("ledger broke");
    assertThat(locks.idle()).isTrue();
    assertThat(bobsItems.count).isEqualTo(16);
  }

  @Test
  void aCatalogEditThatCreatesALoopClosesTheAdminShop() throws Exception {
    // Made while no catalog bought coal: an admin shop paying 60 per 16 coal.
    var before = shopsWith(List.of(), Duration.ZERO, InstantSource.fixed(NOW));
    var admin =
        created(
            before.create(
                new ChestShops.Request(
                    new ShopSignDraft(
                        new OwnerLine.AdminShop(),
                        16,
                        ShopPrices.sellOnly(60),
                        new ItemLine.Named("coal")),
                    ALICE,
                    true,
                    0,
                    place(at(7), Optional.empty()),
                    Optional.of(COAL))));

    // Reynold's now sells coal at 3 each; the admin shop would pay 3.75.
    var after = shopsWith(List.of(REYNOLDS), Duration.ZERO, InstantSource.fixed(NOW));
    var closedShops = after.closeLoopingAdminShops();

    assertThat(closedShops).containsExactly(admin);
    assertThat(registry.closed()).containsOnlyKeys(admin.id());
    var outcome =
        after
            .trade(
                new ChestShops.Visit(
                    admin,
                    Direction.SELL,
                    BOB,
                    new FakeHoldings(16, 64),
                    Holdings.UNLIMITED,
                    List.of()))
            .get();
    assertThat(outcome).isInstanceOf(TradeOutcome.Refused.class);
    assertThat(((TradeOutcome.Refused) outcome).problem())
        .isInstanceOf(TradeProblem.ShopClosed.class);
    assertThat(after.closeLoopingAdminShops()).containsExactly(admin);
  }

  @Test
  void aCheapVariantCountsAsCheapPlainItems() {
    // Renamed coal for 1 crystal per 16 can be ground back to plain coal, which Reynold's buys at
    // 1 crystal each.
    var renamed = new ItemFingerprint("coal", "cmVuYW1lZA==", true);
    var request =
        new ChestShops.Request(
            new ShopSignDraft(
                new OwnerLine.AdminShop(), 16, ShopPrices.buyOnly(1), new ItemLine.Pending()),
            ALICE,
            true,
            0,
            place(at(7), Optional.empty()),
            Optional.of(renamed));

    assertThat(shops.create(request))
        .isEqualTo(Result.err(List.of(new CreationProblem.PriceLoop("Reynold's Supplies"))));
  }
}
