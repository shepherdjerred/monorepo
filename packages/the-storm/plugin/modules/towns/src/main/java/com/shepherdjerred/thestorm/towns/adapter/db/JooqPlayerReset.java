package com.shepherdjerred.thestorm.towns.adapter.db;

import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_CLAIM_TRUST;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LEASES;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LEASE_PAYMENTS;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_HISTORICAL_OWNER;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_LOCK_TRUST;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_MEMBER;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_PENDING_PAYOUT;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_PLOT_RECOVERIES;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_PVP;
import static com.shepherdjerred.thestorm.towns.adapter.db.generated.Tables.TOWNS_TOWN;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Mutable town, lock, PvP and plot state for one account; config-owned parcels remain. */
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
              var ownedTowns =
                  dsl.select(TOWNS_MEMBER.TOWN_ID)
                      .from(TOWNS_MEMBER)
                      .where(TOWNS_MEMBER.PLAYER_ID.eq(id), TOWNS_MEMBER.ROLE.eq("OWNER"));
              dsl.deleteFrom(TOWNS_PENDING_PAYOUT)
                  .where(
                      TOWNS_PENDING_PAYOUT
                          .OWNER_ID
                          .eq(id)
                          .or(TOWNS_PENDING_PAYOUT.TOWN_ID.in(ownedTowns)))
                  .execute();
              dsl.deleteFrom(TOWNS_TOWN).where(TOWNS_TOWN.ID.in(ownedTowns)).execute();
              dsl.deleteFrom(TOWNS_MEMBER).where(TOWNS_MEMBER.PLAYER_ID.eq(id)).execute();
              dsl.deleteFrom(TOWNS_CLAIM_TRUST).where(TOWNS_CLAIM_TRUST.PLAYER_ID.eq(id)).execute();
              dsl.deleteFrom(TOWNS_LOCK_TRUST).where(TOWNS_LOCK_TRUST.PLAYER_ID.eq(id)).execute();
              dsl.deleteFrom(TOWNS_LOCK_HISTORICAL_OWNER)
                  .where(TOWNS_LOCK_HISTORICAL_OWNER.PLAYER_ID.eq(id))
                  .execute();
              dsl.deleteFrom(TOWNS_LOCK).where(TOWNS_LOCK.OWNER_ID.eq(id)).execute();
              dsl.deleteFrom(TOWNS_PVP).where(TOWNS_PVP.PLAYER_ID.eq(id)).execute();
              dsl.deleteFrom(TOWNS_LEASE_PAYMENTS)
                  .where(TOWNS_LEASE_PAYMENTS.OWNER_ID.eq(id))
                  .execute();
              dsl.deleteFrom(TOWNS_LEASES).where(TOWNS_LEASES.OWNER_ID.eq(id)).execute();
              dsl.deleteFrom(TOWNS_PLOT_RECOVERIES)
                  .where(TOWNS_PLOT_RECOVERIES.OWNER_ID.eq(id))
                  .execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
