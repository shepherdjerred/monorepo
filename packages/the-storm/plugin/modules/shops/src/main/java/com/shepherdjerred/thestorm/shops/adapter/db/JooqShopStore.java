package com.shepherdjerred.thestorm.shops.adapter.db;

import static com.shepherdjerred.thestorm.shops.adapter.db.generated.Tables.SHOPS_REFUND_FAILURE;
import static com.shepherdjerred.thestorm.shops.adapter.db.generated.Tables.SHOPS_SHOP;
import static com.shepherdjerred.thestorm.shops.adapter.db.generated.Tables.SHOPS_TRADE;
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
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jspecify.annotations.Nullable;

/** Shop storage in SQLite. Writes run on the database's single writer thread, in a transaction. */
public final class JooqShopStore implements ShopStore {

  private static final String PLAYER = "player";
  private static final String ADMIN = "admin";
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
    return database.write(
        dsl -> {
          var record = dsl.newRecord(SHOPS_SHOP);
          record.setId(Math.toIntExact(shop.id()));
          record.setWorld(shop.sign().world().toString());
          record.setSignX(shop.sign().x());
          record.setSignY(shop.sign().y());
          record.setSignZ(shop.sign().z());
          shop.container()
              .ifPresent(
                  container -> {
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
            case ShopOwner.Admin() -> {
              record.setOwnerKind(ADMIN);
              record.setOwnerName(ADMIN);
            }
          }
          record.setQuantity(shop.quantity());
          shop.prices().buy().ifPresent(price -> record.setBuyPrice(price.crystals()));
          shop.prices().sell().ifPresent(price -> record.setSellPrice(price.crystals()));
          shop.item().ifPresent(item -> setItem(record, item));
          record.setCreatedAt(shop.createdAt().toEpochMilli());
          record.store();
          return shop.id();
        });
  }

  @Override
  public CompletableFuture<Integer> setItem(long shopId, ItemFingerprint item) {
    return database.write(
        dsl ->
            dsl.update(SHOPS_SHOP)
                .set(SHOPS_SHOP.ITEM_MATERIAL, item.material())
                .set(SHOPS_SHOP.ITEM_TEMPLATE, item.template())
                .set(SHOPS_SHOP.ITEM_SPECIAL, item.special() ? 1 : 0)
                .where(SHOPS_SHOP.ID.eq(Math.toIntExact(shopId)))
                .execute());
  }

  @Override
  public CompletableFuture<Integer> deleteShop(long shopId) {
    return database.write(
        dsl ->
            dsl.deleteFrom(SHOPS_SHOP).where(SHOPS_SHOP.ID.eq(Math.toIntExact(shopId))).execute());
  }

  @Override
  public CompletableFuture<Long> recordTrade(TradeRecord trade, boolean ownerNotified) {
    return database.write(
        dsl -> {
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
  public CompletableFuture<List<TradeRecord>> takeUnnotified(UUID owner) {
    var ownerId = owner.toString();
    return database.write(
        dsl -> {
          var pending =
              dsl.selectFrom(SHOPS_TRADE)
                  .where(
                      SHOPS_TRADE.SOURCE.eq(CHEST),
                      SHOPS_TRADE.OWNER_ID.eq(ownerId),
                      SHOPS_TRADE.OWNER_NOTIFIED.eq(0))
                  .orderBy(SHOPS_TRADE.ID)
                  .fetch();
          if (pending.isNotEmpty()) {
            dsl.update(SHOPS_TRADE)
                .set(SHOPS_TRADE.OWNER_NOTIFIED, 1)
                .where(SHOPS_TRADE.ID.in(pending.getValues(SHOPS_TRADE.ID)))
                .execute();
          }
          return pending.map(JooqShopStore::toTrade);
        });
  }

  @Override
  public CompletableFuture<Integer> catalogUsage(CatalogUsageQuery query) {
    return database.read(
        dsl -> {
          var total =
              dsl.select(sum(SHOPS_TRADE.QUANTITY))
                  .from(SHOPS_TRADE)
                  .where(
                      SHOPS_TRADE.CUSTOMER_ID.eq(query.customer().toString()),
                      SHOPS_TRADE.SOURCE.eq(CATALOG),
                      SHOPS_TRADE.CATALOG_ID.eq(query.catalogId()),
                      SHOPS_TRADE.ITEM_MATERIAL.eq(query.itemKey()),
                      SHOPS_TRADE.DIRECTION.eq(query.direction().id()),
                      SHOPS_TRADE.AT.ge(query.since().toEpochMilli()))
                  .fetchOne(0, Integer.class);
          return total == null ? 0 : total;
        });
  }

  @Override
  public CompletableFuture<Long> recordRefundFailure(RefundFailure failure) {
    return database.write(
        dsl -> {
          var record = dsl.newRecord(SHOPS_REFUND_FAILURE);
          record.setPayerKind(kind(failure.payer()));
          record.setPayerId(id(failure.payer()));
          record.setPayeeKind(kind(failure.payee()));
          record.setPayeeId(id(failure.payee()));
          record.setAmount(failure.amount().amount());
          record.setReason(failure.reason());
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
            .map(
                x ->
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
          case ADMIN -> new ShopOwner.Admin();
          default -> throw new IllegalStateException("unknown owner kind " + record.getOwnerKind());
        };
    var prices =
        new ShopPrices(
            Optional.ofNullable(nullable(record.getBuyPrice())).map(Price::of),
            Optional.ofNullable(nullable(record.getSellPrice())).map(Price::of));
    var item =
        Optional.ofNullable(nullable(record.getItemMaterial()))
            .map(
                material ->
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
