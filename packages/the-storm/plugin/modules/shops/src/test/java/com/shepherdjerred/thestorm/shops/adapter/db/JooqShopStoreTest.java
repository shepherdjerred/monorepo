package com.shepherdjerred.thestorm.shops.adapter.db;

import static com.shepherdjerred.thestorm.shops.adapter.db.generated.Tables.SHOPS_REFUND_FAILURE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.shops.app.HeldItems;
import com.shepherdjerred.thestorm.shops.app.RefundFailure;
import com.shepherdjerred.thestorm.shops.app.ShopStore;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqShopStoreTest {

  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00.123Z");
  private static final UUID WORLD = new UUID(9, 9);
  private static final UUID ALICE = new UUID(0, 1);
  private static final UUID BOB = new UUID(0, 2);
  private static final ItemFingerprint SWORD =
      new ItemFingerprint("diamond_sword", "c3dvcmQ=", true);

  @TempDir Path directory;

  private StormDatabase database;
  private JooqShopStore store;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("shops", JooqShopStoreTest.class.getClassLoader());
    store = new JooqShopStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static SignShop chestShop(long id, int x) {
    return new SignShop(
        id,
        new BlockPos(WORLD, x, 65, -3),
        Optional.of(new BlockPos(WORLD, x, 64, -3)),
        new ShopOwner.Player(ALICE, "Alice"),
        16,
        ShopPrices.both(50, 40),
        Optional.of(SWORD),
        NOW);
  }

  private static SignShop adminShop(long id) {
    return new SignShop(
        id,
        new BlockPos(WORLD, 100, 70, 100),
        Optional.empty(),
        new ShopOwner.Admin(),
        1,
        ShopPrices.sellOnly(12),
        Optional.empty(),
        NOW);
  }

  private static TradeRecord trade(TradeSite site, UUID customer, Direction direction, Instant at) {
    return new TradeRecord(site, customer, "Bob", direction, "emerald", 4, 48, at);
  }

  @Test
  void shopsRoundTrip() throws Exception {
    var chest = chestShop(1, 0);
    var admin = adminShop(2);

    assertThat(store.saveShop(chest).get()).isEqualTo(1);
    store.saveShop(admin).get();

    assertThat(store.loadShops().get()).containsExactly(chest, admin);
  }

  @Test
  void aPendingShopGetsItsItemLater() throws Exception {
    var admin = adminShop(1);
    store.saveShop(admin).get();

    assertThat(store.setItem(1, SWORD).get()).isEqualTo(1);

    assertThat(store.loadShops().get()).containsExactly(admin.withItem(SWORD));
  }

  @Test
  void deletingAShopKeepsItsTrades() throws Exception {
    store.saveShop(chestShop(1, 0)).get();
    store.recordTrade(trade(new TradeSite.Chest(1, ALICE), BOB, Direction.BUY, NOW), false).get();

    assertThat(store.deleteShop(1).get()).isEqualTo(1);
    assertThat(store.deleteShop(1).get()).isZero();

    assertThat(store.loadShops().get()).isEmpty();
    assertThat(store.takeUnnotified(ALICE).get()).hasSize(1);
  }

  @Test
  void aSignHoldsOneShop() throws Exception {
    store.saveShop(chestShop(1, 0)).get();

    assertThatThrownBy(() -> store.saveShop(chestShop(2, 0)).get())
        .isInstanceOf(ExecutionException.class);
  }

  @Test
  void unnotifiedTradesAreTakenOnceOldestFirst() throws Exception {
    var site = new TradeSite.Chest(1, ALICE);
    var first = trade(site, BOB, Direction.BUY, NOW);
    var second = trade(site, BOB, Direction.SELL, NOW.plusSeconds(1));
    store.recordTrade(first, false).get();
    store.recordTrade(trade(site, BOB, Direction.BUY, NOW), true).get();
    store.recordTrade(second, false).get();
    store.recordTrade(trade(new TradeSite.Chest(2, BOB), ALICE, Direction.BUY, NOW), false).get();

    assertThat(store.takeUnnotified(ALICE).get()).containsExactly(first, second);
    assertThat(store.takeUnnotified(ALICE).get()).isEmpty();
    assertThat(store.takeUnnotified(BOB).get()).hasSize(1);
  }

  @Test
  void everyTradeSiteRoundTrips() throws Exception {
    var owner = UUID.randomUUID();
    var chest = trade(new TradeSite.Chest(5, owner), BOB, Direction.BUY, NOW);
    store.recordTrade(chest, false).get();
    store.recordTrade(trade(new TradeSite.Admin(6), BOB, Direction.BUY, NOW), true).get();
    store.recordTrade(trade(new TradeSite.Catalog("baker"), BOB, Direction.SELL, NOW), true).get();

    assertThat(store.takeUnnotified(owner).get()).containsExactly(chest);
  }

  @Test
  void catalogUsageCountsTodaysTradesPerItemAndDirection() throws Exception {
    var baker = new TradeSite.Catalog("baker");
    var dayStart = Instant.parse("2026-09-25T00:00:00Z");
    store.recordTrade(trade(baker, BOB, Direction.SELL, dayStart), true).get();
    store.recordTrade(trade(baker, BOB, Direction.SELL, NOW), true).get();
    store.recordTrade(trade(baker, BOB, Direction.SELL, dayStart.minusMillis(1)), true).get();
    store.recordTrade(trade(baker, BOB, Direction.BUY, NOW), true).get();
    store.recordTrade(trade(baker, ALICE, Direction.SELL, NOW), true).get();
    store
        .recordTrade(trade(new TradeSite.Catalog("florist"), BOB, Direction.SELL, NOW), true)
        .get();

    assertThat(store.catalogUsageSince(BOB, dayStart).get())
        .containsOnly(
            Map.entry(new ShopStore.UsageKey("baker", "emerald", Direction.SELL), 8),
            Map.entry(new ShopStore.UsageKey("baker", "emerald", Direction.BUY), 4),
            Map.entry(new ShopStore.UsageKey("florist", "emerald", Direction.SELL), 4));
    assertThat(store.catalogUsageSince(new UUID(5, 5), dayStart).get()).isEmpty();
  }

  @Test
  void theLastIssuedShopIdSurvivesDeletingThatShop() throws Exception {
    assertThat(store.lastShopId().get()).isZero();
    store.saveShop(chestShop(1, 0)).get();
    store.saveShop(chestShop(7, 5)).get();

    store.deleteShop(7).get();

    assertThat(store.lastShopId().get()).isEqualTo(7);
  }

  @Test
  void heldItemsNeedBothAnItemAndAQuantity() {
    assertThatThrownBy(
            () ->
                database
                    .write(
                        dsl ->
                            dsl.execute(
                                "insert into shops_refund_failure (payer_kind, payer_id,"
                                    + " payee_kind, payee_id, amount, reason, at, held_item)"
                                    + " values ('player', 'a', 'player', 'b', 1, 'r', 0, 'coal')"))
                    .get())
        .isInstanceOf(ExecutionException.class)
        .hasMessageContaining("CHECK");
  }

  @Test
  void refundFailuresAreKeptForStaff() throws Exception {
    var failure =
        new RefundFailure(
            new AccountId.Player(ALICE),
            new AccountId.Player(BOB),
            Crystals.of(50),
            "refund:shop:1:buy",
            Optional.of(new HeldItems("c3dvcmQ=", 16)),
            NOW);

    assertThat(store.recordRefundFailure(failure).get()).isEqualTo(1);
    assertThat(
            store
                .recordRefundFailure(
                    new RefundFailure(
                        new AccountId.Server(),
                        new AccountId.Town(BOB),
                        Crystals.of(1),
                        "r",
                        Optional.empty(),
                        NOW))
                .get())
        .isEqualTo(2);

    var rows = database.read(dsl -> dsl.selectFrom(SHOPS_REFUND_FAILURE).fetch()).get();
    assertThat(rows).hasSize(2);
    assertThat(rows.getFirst().getPayerKind()).isEqualTo("player");
    assertThat(rows.getFirst().getHeldItem()).isEqualTo("c3dvcmQ=");
    assertThat(rows.getFirst().getHeldQuantity()).isEqualTo(16);
    assertThat(rows.get(1).getHeldItem()).isNull();
    assertThat(rows.getFirst().getPayeeId()).isEqualTo(BOB.toString());
    assertThat(rows.getFirst().getAmount()).isEqualTo(50);
    assertThat(rows.get(1).getPayerKind()).isEqualTo("server");
    assertThat(rows.get(1).getPayeeKind()).isEqualTo("town");
  }
}
