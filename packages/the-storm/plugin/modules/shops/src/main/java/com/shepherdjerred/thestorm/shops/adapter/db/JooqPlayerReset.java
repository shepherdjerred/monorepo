package com.shepherdjerred.thestorm.shops.adapter.db;

import static com.shepherdjerred.thestorm.shops.adapter.db.generated.Tables.SHOPS_REFUND_FAILURE;
import static com.shepherdjerred.thestorm.shops.adapter.db.generated.Tables.SHOPS_SHOP;
import static com.shepherdjerred.thestorm.shops.adapter.db.generated.Tables.SHOPS_TRADE;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Shop ownership, trade history and unsettled refunds for one account. */
public final class JooqPlayerReset {

  private final StormDatabase database;

  public JooqPlayerReset(StormDatabase database) {
    this.database = database;
  }

  public CompletableFuture<Void> reset(UUID player) {
    var id = player.toString();
    return database
        .write(
            dsl -> {
              dsl.deleteFrom(SHOPS_SHOP)
                  .where(SHOPS_SHOP.OWNER_KIND.eq("player"), SHOPS_SHOP.OWNER_ID.eq(id))
                  .execute();
              dsl.deleteFrom(SHOPS_TRADE)
                  .where(SHOPS_TRADE.CUSTOMER_ID.eq(id).or(SHOPS_TRADE.OWNER_ID.eq(id)))
                  .execute();
              dsl.deleteFrom(SHOPS_REFUND_FAILURE)
                  .where(
                      SHOPS_REFUND_FAILURE
                          .PAYER_KIND
                          .eq("player")
                          .and(SHOPS_REFUND_FAILURE.PAYER_ID.eq(id)))
                  .or(
                      SHOPS_REFUND_FAILURE
                          .PAYEE_KIND
                          .eq("player")
                          .and(SHOPS_REFUND_FAILURE.PAYEE_ID.eq(id)))
                  .execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
