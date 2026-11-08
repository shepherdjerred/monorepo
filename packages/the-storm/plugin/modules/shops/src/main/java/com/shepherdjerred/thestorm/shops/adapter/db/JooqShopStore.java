package com.shepherdjerred.thestorm.shops.adapter.db;

import static com.shepherdjerred.thestorm.shops.adapter.db.generated.Tables.SHOPS_REFUND_FAILURE;
import static com.shepherdjerred.thestorm.shops.adapter.db.generated.Tables.SHOPS_SHOP;
import static com.shepherdjerred.thestorm.shops.adapter.db.generated.Tables.SHOPS_TRADE;
import static java.util.stream.Collectors.toUnmodifiableMap;
import static org.jooq.impl.DSL.sum;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.shops.adapter.db.generated.tables.records.ShopsShopRecord;
import com.shepherdjerred.thestorm.shops.adapter.db.generated.tables.records.ShopsTradeRecord;
import com.shepherdjerred.thestorm.shops.app.RefundFailure;
import com.shepherdjerred.thestorm.shops.app.ShopStore;
import com.shepherdjerred.thestorm.shops.domain.price.Price;
import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jspecify.annotations.Nullable;

/** Shop storage in SQLite. Writes run on the database's single writer thread, in a transaction. */
public final class JooqShopStore implements ShopStore {

  private static final String PLAYER = "player";
  private static final String ADMIN = "admin";
  private static final String TOWN = "town";
  private static final String CHEST = "chest";
  private static final String CATALOG = "catalog";

  private final StormDatabase database;

  public JooqShopStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<List<SignShop>> loadShops() {
    return database.read(
        dsl -> dsl.selectFrom(SHOPS_SHOP).orderBy(SHOPS_SHOP.ID).fetch(JooqShopStore::toShop));
  }

  @Override
  public CompletableFuture<Long> saveShop(SignShop shop) {
    return database.write(dsl -> {
      insertShop(dsl, shop);
      return shop.id();
    });
  }

  @Override
  public CompletableFuture<Long> indexShop(SignShop shop) {
    return database.write(dsl -> {
      var record = shopRecord(dsl, shop);
      dsl.insertInto(SHOPS_SHOP)
          .set(record)
          .onConflict(SHOPS_SHOP.ID)
          .doUpdate()
          .set(record)
          .execute();
      return shop.id();
    });
  }

  /**
   * Atomically records a verified historical shop and its permanent receipt. A conflicting modern
   * sign is left untouched; removing an imported shop never causes it to be recreated.
   */
  public CompletableFuture<HistoricalImport> importHistorical(String sourceId, SignShop shop) {
    if (sourceId.isBlank()) throw new IllegalArgumentException("blank historical shop identity");
    if (!historicalAuthority(shop.owner()) || shop.container().isEmpty()) {
      throw new IllegalArgumentException(
          "historical shops require a player or finite staff custody, and a container");
    }
    if (!shop.container().orElseThrow().world().equals(shop.sign().world())) {
      throw new IllegalArgumentException("historical sign and container must share a world");
    }
    if (shop.item().isEmpty()) {
      throw new IllegalArgumentException("historical shop item must be identified");
    }
    return database.write(dsl -> {
      var sign = shop.sign();
      var receipt =
          dsl.fetchOne(
              "select world, sign_x, sign_y, sign_z from shops_historical_import where source_id = ?",
              sourceId);
      if (receipt != null) {
        if (!sign.world().toString().equals(receipt.get("world", String.class))
            || sign.x() != receipt.get("sign_x", Integer.class)
            || sign.y() != receipt.get("sign_y", Integer.class)
            || sign.z() != receipt.get("sign_z", Integer.class)) {
          throw new IllegalStateException("historical shop identity changed position: " + sourceId);
        }
        return HistoricalImport.ALREADY_IMPORTED;
      }
      var world = sign.world().toString();
      if (dsl.fetchExists(
              dsl.selectOne()
                  .from(SHOPS_SHOP)
                  .where(
                      SHOPS_SHOP.WORLD.eq(world),
                      SHOPS_SHOP.SIGN_X.eq(sign.x()),
                      SHOPS_SHOP.SIGN_Y.eq(sign.y()),
                      SHOPS_SHOP.SIGN_Z.eq(sign.z())))
          || dsl.fetchOne(
                  "select 1 from shops_historical_import where world = ? and sign_x = ? and sign_y = ? and sign_z = ?",
                  world,
                  sign.x(),
                  sign.y(),
                  sign.z())
              != null) {
        return HistoricalImport.CONFLICT;
      }
      insertShop(dsl, shop);
      dsl.execute(
          "insert into shops_historical_import (source_id, world, sign_x, sign_y, sign_z, shop_id, state) values (?, ?, ?, ?, ?, ?, 'in_doubt')",
          sourceId,
          world,
          sign.x(),
          sign.y(),
          sign.z(),
          shop.id());
      return HistoricalImport.IMPORTED;
    });
  }

  private static boolean historicalAuthority(ShopOwner owner) {
    return owner instanceof ShopOwner.Player
        || (owner instanceof ShopOwner.Admin(var finite) && finite);
  }

  public enum HistoricalImport {
    IMPORTED,
    ALREADY_IMPORTED,
    CONFLICT
  }

  /** An interrupted world write is never repeated automatically. */
  public CompletableFuture<List<Long>> pendingHistoricalShops() {
    return database.read(dsl ->
        dsl.fetch("select shop_id from shops_historical_import where state = 'in_doubt'")
            .map(row -> row.get("shop_id", Long.class)));
  }

  /** Completed receipts retain the source-to-shop link even after a shop is removed. */
  public CompletableFuture<Map<String, Long>> completedHistoricalShops() {
    return database.read(dsl ->
        dsl
            .fetch(
                "select source_id, shop_id from shops_historical_import where state = 'complete'")
            .stream()
            .collect(
                toUnmodifiableMap(
                    row -> row.get("source_id", String.class),
                    row -> row.get("shop_id", Long.class))));
  }

  public CompletableFuture<Integer> completeHistorical(String sourceId, long shopId) {
    return database.write(dsl ->
        dsl.execute(
            "update shops_historical_import set state = 'complete' where source_id = ? and shop_id = ? and state = 'in_doubt'",
            sourceId,
            shopId));
  }

  /** Cancels a pending import only when the caller has not changed the world. */
  public CompletableFuture<Boolean> cancelHistorical(String sourceId, long shopId) {
    return database.write(dsl -> {
      var removed =
          dsl.execute(
              "delete from shops_historical_import where source_id = ? and shop_id = ? and state = 'in_doubt'",
              sourceId,
              shopId);
      if (removed == 0) return false;
      if (dsl.deleteFrom(SHOPS_SHOP).where(SHOPS_SHOP.ID.eq(Math.toIntExact(shopId))).execute()
          != 1) {
        throw new IllegalStateException("pending historical shop disappeared: " + shopId);
      }
      return true;
    });
  }

  private static void insertShop(org.jooq.DSLContext dsl, SignShop shop) {
    shopRecord(dsl, shop).store();
  }

  private static ShopsShopRecord shopRecord(org.jooq.DSLContext dsl, SignShop shop) {
    var record = dsl.newRecord(SHOPS_SHOP);
    record.setId(Math.toIntExact(shop.id()));
    record.setWorld(shop.sign().world().toString());
    record.setSignX(shop.sign().x());
    record.setSignY(shop.sign().y());
    record.setSignZ(shop.sign().z());
    shop.container()
        .ifPresent(container -> {
          record.setContainerX(container.x());
          record.setContainerY(container.y());
          record.setContainerZ(container.z());
        });
    switch (shop.owner()) {
      case ShopOwner.Player(var id, var name) -> {
        record.setOwnerKind(PLAYER);
        record.setOwnerId(id.toString());
        record.setOwnerName(name);
      }
      case ShopOwner.Town(var id, var name) -> {
        record.setOwnerKind(TOWN);
        record.setOwnerId(id.toString());
        record.setOwnerName(name);
      }
      case ShopOwner.Admin(_) -> {
        record.setOwnerKind(ADMIN);
        record.setOwnerName(ADMIN);
      }
    }
    record.setAdminStocked(shop.owner() instanceof ShopOwner.Admin(var finite) && finite ? 1 : 0);
    record.setQuantity(shop.quantity());
    shop.prices().buy().ifPresent(price -> record.setBuyPrice(price.crystals()));
    shop.prices().sell().ifPresent(price -> record.setSellPrice(price.crystals()));
    shop.item().ifPresent(item -> setItem(record, item));
    record.setCreatedAt(shop.createdAt().toEpochMilli());
    return record;
  }

  @Override
  public CompletableFuture<Integer> setItem(long shopId, ItemFingerprint item) {
    return database.write(dsl ->
        dsl.update(SHOPS_SHOP)
            .set(SHOPS_SHOP.ITEM_MATERIAL, item.material())
            .set(SHOPS_SHOP.ITEM_TEMPLATE, item.template())
            .set(SHOPS_SHOP.ITEM_SPECIAL, item.special() ? 1 : 0)
            .where(SHOPS_SHOP.ID.eq(Math.toIntExact(shopId)))
            .execute());
  }

  @Override
  public CompletableFuture<Integer> deleteShop(long shopId) {
    return database.write(dsl ->
        dsl.deleteFrom(SHOPS_SHOP).where(SHOPS_SHOP.ID.eq(Math.toIntExact(shopId))).execute());
  }

  @Override
  public CompletableFuture<Long> recordTrade(TradeRecord trade, boolean ownerNotified) {
    return database.write(dsl -> {
      var record = dsl.newRecord(SHOPS_TRADE);
      switch (trade.site()) {
        case TradeSite.Chest(var shopId, var owner) -> {
          record.setSource(CHEST);
          record.setShopId(Math.toIntExact(shopId));
          record.setOwnerId(owner.toString());
        }
        case TradeSite.Admin(var shopId) -> {
          record.setSource(ADMIN);
          record.setShopId(Math.toIntExact(shopId));
        }
        case TradeSite.Catalog(var catalogId) -> {
          record.setSource(CATALOG);
          record.setCatalogId(catalogId);
        }
      }
      record.setCustomerId(trade.customer().toString());
      record.setCustomerName(trade.customerName());
      record.setDirection(trade.direction().id());
      record.setItemMaterial(trade.material());
      record.setQuantity(trade.quantity());
      record.setPrice(trade.price());
      record.setAt(trade.at().toEpochMilli());
      record.setOwnerNotified(ownerNotified ? 1 : 0);
      record.store();
      return record.getId().longValue();
    });
  }

  @Override
  public CompletableFuture<List<PendingTrade>> listUnnotified(UUID owner) {
    var ownerId = owner.toString();
    return database.read(dsl ->
        dsl.selectFrom(SHOPS_TRADE)
            .where(
                SHOPS_TRADE.SOURCE.eq(CHEST),
                SHOPS_TRADE.OWNER_ID.eq(ownerId),
                SHOPS_TRADE.OWNER_NOTIFIED.eq(0))
            .orderBy(SHOPS_TRADE.ID)
            .fetch(row -> new PendingTrade(row.getId().longValue(), toTrade(row))));
  }

  @Override
  public CompletableFuture<Integer> markNotified(UUID owner, List<Long> ids) {
    if (ids.isEmpty()) {
      return CompletableFuture.completedFuture(0);
    }
    var storedIds = ids.stream().map(Math::toIntExact).toList();
    return database.write(dsl ->
        dsl.update(SHOPS_TRADE)
            .set(SHOPS_TRADE.OWNER_NOTIFIED, 1)
            .where(
                SHOPS_TRADE.SOURCE.eq(CHEST),
                SHOPS_TRADE.OWNER_ID.eq(owner.toString()),
                SHOPS_TRADE.OWNER_NOTIFIED.eq(0),
                SHOPS_TRADE.ID.in(storedIds))
            .execute());
  }

  @Override
  public CompletableFuture<Map<UsageKey, Integer>> catalogUsageSince(UUID customer, Instant since) {
    var total = sum(SHOPS_TRADE.QUANTITY);
    return database.read(dsl ->
        dsl.select(SHOPS_TRADE.CATALOG_ID, SHOPS_TRADE.ITEM_MATERIAL, SHOPS_TRADE.DIRECTION, total)
            .from(SHOPS_TRADE)
            .where(
                SHOPS_TRADE.CUSTOMER_ID.eq(customer.toString()),
                SHOPS_TRADE.SOURCE.eq(CATALOG),
                SHOPS_TRADE.AT.ge(since.toEpochMilli()))
            .groupBy(SHOPS_TRADE.CATALOG_ID, SHOPS_TRADE.ITEM_MATERIAL, SHOPS_TRADE.DIRECTION)
            .fetchMap(
                row ->
                    new UsageKey(
                        requireColumn(row.value1()), row.value2(), Direction.fromId(row.value3())),
                row -> requireColumn(row.value4()).intValueExact()));
  }

  @Override
  public CompletableFuture<Long> lastShopId() {
    // AUTOINCREMENT keeps the highest id ever used, even after that shop is deleted.
    return database.read(dsl ->
        dsl.resultQuery("select seq from sqlite_sequence where name = ?", "shops_shop")
            .fetchOptional(0, Long.class)
            .orElse(0L));
  }

  @Override
  public CompletableFuture<Long> recordRefundFailure(RefundFailure failure) {
    return database.write(dsl -> {
      var record = dsl.newRecord(SHOPS_REFUND_FAILURE);
      record.setPayerKind(kind(failure.payer()));
      record.setPayerId(id(failure.payer()));
      record.setPayeeKind(kind(failure.payee()));
      record.setPayeeId(id(failure.payee()));
      record.setAmount(failure.amount().amount());
      record.setReason(failure.reason());
      failure
          .held()
          .ifPresent(held -> {
            record.setHeldItem(held.item());
            record.setHeldQuantity(held.quantity());
          });
      record.setAt(failure.at().toEpochMilli());
      record.store();
      return record.getId().longValue();
    });
  }

  private static void setItem(ShopsShopRecord record, ItemFingerprint item) {
    record.setItemMaterial(item.material());
    record.setItemTemplate(item.template());
    record.setItemSpecial(item.special() ? 1 : 0);
  }

  private static SignShop toShop(ShopsShopRecord record) {
    var world = UUID.fromString(record.getWorld());
    var sign = new BlockPos(world, record.getSignX(), record.getSignY(), record.getSignZ());
    var container =
        Optional.ofNullable(nullable(record.getContainerX()))
            .map(x ->
                new BlockPos(
                    world,
                    x,
                    requireColumn(record.getContainerY()),
                    requireColumn(record.getContainerZ())));
    ShopOwner owner =
        switch (record.getOwnerKind()) {
          case PLAYER ->
              new ShopOwner.Player(
                  UUID.fromString(requireColumn(record.getOwnerId())), record.getOwnerName());
          case TOWN ->
              new ShopOwner.Town(
                  UUID.fromString(requireColumn(record.getOwnerId())), record.getOwnerName());
          case ADMIN -> new ShopOwner.Admin(record.getAdminStocked() == 1);
          default -> throw new IllegalStateException("unknown owner kind " + record.getOwnerKind());
        };
    var prices =
        new ShopPrices(
            Optional.ofNullable(nullable(record.getBuyPrice())).map(Price::of),
            Optional.ofNullable(nullable(record.getSellPrice())).map(Price::of));
    var item =
        Optional.ofNullable(nullable(record.getItemMaterial()))
            .map(material ->
                new ItemFingerprint(
                    material,
                    requireColumn(record.getItemTemplate()),
                    requireColumn(record.getItemSpecial()) == 1));
    return new SignShop(
        record.getId(),
        sign,
        container,
        owner,
        record.getQuantity(),
        prices,
        item,
        Instant.ofEpochMilli(record.getCreatedAt()));
  }

  private static TradeRecord toTrade(ShopsTradeRecord record) {
    TradeSite site =
        switch (record.getSource()) {
          case CHEST ->
              new TradeSite.Chest(
                  requireColumn(record.getShopId()),
                  UUID.fromString(requireColumn(record.getOwnerId())));
          case ADMIN -> new TradeSite.Admin(requireColumn(record.getShopId()));
          case CATALOG -> new TradeSite.Catalog(requireColumn(record.getCatalogId()));
          default -> throw new IllegalStateException("unknown trade source " + record.getSource());
        };
    return new TradeRecord(
        site,
        UUID.fromString(record.getCustomerId()),
        record.getCustomerName(),
        Direction.fromId(record.getDirection()),
        record.getItemMaterial(),
        record.getQuantity(),
        record.getPrice(),
        Instant.ofEpochMilli(record.getAt()));
  }

  private static String kind(AccountId account) {
    return switch (account) {
      case AccountId.Player(_) -> PLAYER;
      case AccountId.Town(_) -> "town";
      case AccountId.Server() -> "server";
    };
  }

  private static String id(AccountId account) {
    return switch (account) {
      case AccountId.Player(var uuid) -> uuid.toString();
      case AccountId.Town(var townId) -> townId.toString();
      case AccountId.Server() -> "server";
    };
  }

  /** jOOQ's generated getters are unannotated; nullable columns are read through here. */
  private static <T> @Nullable T nullable(@Nullable T value) {
    return value;
  }

  /** A nullable column that the table's CHECK constraints guarantee is set. */
  private static <T> T requireColumn(@Nullable T value) {
    if (value == null) {
      throw new IllegalStateException("a column the schema requires is NULL");
    }
    return value;
  }
}
