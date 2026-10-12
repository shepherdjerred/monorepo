package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_KIT_OWNED;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_KIT_PURCHASE;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_PLAYER_PREFS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.rwf.adapter.db.generated.tables.records.RwfKitPurchaseRecord;
import com.shepherdjerred.thestorm.rwf.app.shop.KitPrefs;
import com.shepherdjerred.thestorm.rwf.app.shop.KitShop;
import com.shepherdjerred.thestorm.rwf.app.shop.KitStore;
import com.shepherdjerred.thestorm.rwf.app.shop.Purchase;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitLayout;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/** {@link KitStore} over {@code rwf_kit_owned} and the {@code rwf_kit_purchase} outbox. */
public final class JooqKitStore implements KitStore {

  static final String PENDING = "PENDING";
  static final String GRANTED = "GRANTED";
  static final String CANCELLED = "CANCELLED";
  static final String PURCHASE = "PURCHASE";

  private final StormDatabase database;

  public JooqKitStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Set<String>> owned(UUID player) {
    return database.read(
        dsl ->
            Set.copyOf(
                dsl.select(RWF_KIT_OWNED.KIT)
                    .from(RWF_KIT_OWNED)
                    .where(RWF_KIT_OWNED.PLAYER.eq(player.toString()))
                    .fetch(RWF_KIT_OWNED.KIT)));
  }

  @Override
  public CompletableFuture<Boolean> begin(Purchase purchase) {
    return database.write(
        dsl -> {
          var player = purchase.player().toString();
          var owned =
              dsl.fetchExists(
                  dsl.selectFrom(RWF_KIT_OWNED)
                      .where(RWF_KIT_OWNED.PLAYER.eq(player))
                      .and(RWF_KIT_OWNED.KIT.eq(purchase.kit())));
          var pending =
              dsl.fetchExists(
                  dsl.selectFrom(RWF_KIT_PURCHASE)
                      .where(RWF_KIT_PURCHASE.PLAYER.eq(player))
                      .and(RWF_KIT_PURCHASE.KIT.eq(purchase.kit()))
                      .and(RWF_KIT_PURCHASE.STATUS.eq(PENDING)));
          if (owned || pending) {
            return false;
          }
          dsl.insertInto(RWF_KIT_PURCHASE)
              .set(RWF_KIT_PURCHASE.ID, purchase.id().toString())
              .set(RWF_KIT_PURCHASE.PLAYER, player)
              .set(RWF_KIT_PURCHASE.KIT, purchase.kit())
              .set(RWF_KIT_PURCHASE.CURRENCY, KitShop.CURRENCY.key())
              .set(RWF_KIT_PURCHASE.PRICE, purchase.price())
              .set(RWF_KIT_PURCHASE.STATUS, PENDING)
              .set(RWF_KIT_PURCHASE.CREATED_AT, purchase.at().toEpochMilli())
              .execute();
          return true;
        });
  }

  @Override
  public CompletableFuture<Void> grant(UUID purchase, Instant at) {
    return Writes.done(
        database.write(
            dsl -> {
              var row = fetch(dsl, purchase);
              switch (row.getStatus()) {
                case GRANTED -> {
                  return false;
                }
                case CANCELLED ->
                    throw new IllegalStateException(
                        "purchase " + purchase + " was cancelled; it cannot be granted");
                default -> {}
              }
              dsl.insertInto(RWF_KIT_OWNED)
                  .set(RWF_KIT_OWNED.PLAYER, row.getPlayer())
                  .set(RWF_KIT_OWNED.KIT, row.getKit())
                  .set(RWF_KIT_OWNED.ACQUIRED_AT, at.toEpochMilli())
                  .set(RWF_KIT_OWNED.SOURCE, PURCHASE)
                  .onConflictDoNothing()
                  .execute();
              settle(dsl, purchase, GRANTED, at);
              return true;
            }));
  }

  @Override
  public CompletableFuture<Void> cancel(UUID purchase, Instant at) {
    return Writes.done(
        database.write(
            dsl -> {
              var row = fetch(dsl, purchase);
              if (GRANTED.equals(row.getStatus())) {
                throw new IllegalStateException(
                    "purchase " + purchase + " was granted; it cannot be cancelled");
              }
              settle(dsl, purchase, CANCELLED, at);
              return true;
            }));
  }

  @Override
  public CompletableFuture<List<Purchase>> pending() {
    return database.read(
        dsl ->
            dsl
                .selectFrom(RWF_KIT_PURCHASE)
                .where(RWF_KIT_PURCHASE.STATUS.eq(PENDING))
                .orderBy(RWF_KIT_PURCHASE.CREATED_AT, RWF_KIT_PURCHASE.ID)
                .fetch()
                .stream()
                .map(JooqKitStore::toPurchase)
                .toList());
  }

  @Override
  public CompletableFuture<KitPrefs> prefs(UUID player) {
    return database.read(
        dsl ->
            dsl.selectFrom(RWF_PLAYER_PREFS)
                .where(RWF_PLAYER_PREFS.PLAYER.eq(player.toString()))
                .fetchOptional()
                .map(
                    row ->
                        new KitPrefs(
                            Optional.ofNullable(row.getLastKit()),
                            KitLayoutsJson.read(row.getKitLayouts())))
                .orElse(KitPrefs.NONE));
  }

  @Override
  public CompletableFuture<Void> saveLayout(UUID player, String kit, KitLayout layout) {
    return Writes.done(
        database.write(
            dsl -> {
              var id = player.toString();
              var row =
                  dsl.selectFrom(RWF_PLAYER_PREFS)
                      .where(RWF_PLAYER_PREFS.PLAYER.eq(id))
                      .fetchOptional();
              var layouts =
                  new HashMap<>(
                      row.map(r -> KitLayoutsJson.read(r.getKitLayouts())).orElseGet(Map::of));
              layouts.put(kit, layout);
              var json = KitLayoutsJson.write(layouts);
              if (row.isPresent()) {
                dsl.update(RWF_PLAYER_PREFS)
                    .set(RWF_PLAYER_PREFS.KIT_LAYOUTS, json)
                    .where(RWF_PLAYER_PREFS.PLAYER.eq(id))
                    .execute();
              } else {
                // A new row keeps Red Warfare's default of auto team chat on.
                dsl.insertInto(RWF_PLAYER_PREFS)
                    .set(RWF_PLAYER_PREFS.PLAYER, id)
                    .set(RWF_PLAYER_PREFS.TEAM_CHAT, true)
                    .set(RWF_PLAYER_PREFS.KIT_LAYOUTS, json)
                    .execute();
              }
              return true;
            }));
  }

  private static void settle(DSLContext dsl, UUID purchase, String status, Instant at) {
    dsl.update(RWF_KIT_PURCHASE)
        .set(RWF_KIT_PURCHASE.STATUS, status)
        .set(RWF_KIT_PURCHASE.SETTLED_AT, at.toEpochMilli())
        .where(RWF_KIT_PURCHASE.ID.eq(purchase.toString()))
        .execute();
  }

  private static RwfKitPurchaseRecord fetch(DSLContext dsl, UUID purchase) {
    var row =
        dsl.selectFrom(RWF_KIT_PURCHASE)
            .where(RWF_KIT_PURCHASE.ID.eq(purchase.toString()))
            .fetchOne();
    if (row == null) {
      throw new IllegalStateException("no kit purchase " + purchase);
    }
    return row;
  }

  private static Purchase toPurchase(RwfKitPurchaseRecord row) {
    return new Purchase(
        UUID.fromString(row.getId()),
        UUID.fromString(row.getPlayer()),
        row.getKit(),
        row.getPrice(),
        Instant.ofEpochMilli(row.getCreatedAt()));
  }
}
