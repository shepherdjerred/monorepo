package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_BACK_HISTORY;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_HOMES;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_KIT_CLAIMS;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_KIT_DELIVERIES;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_MODERATION_LOG;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_PLAYERS;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_STAFF_AUDIT;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_STAFF_STATE;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_ATTEMPTS;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_CONFIRMATIONS;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_COOLDOWNS;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_STATE;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_TELEPORT_USES;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Every mutable Essentials record owned by one account; shared warps and IP bans remain. */
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
              dsl.deleteFrom(ESSENTIALS_HOMES).where(ESSENTIALS_HOMES.PLAYER.eq(id)).execute();
              dsl.deleteFrom(ESSENTIALS_BACK_HISTORY)
                  .where(ESSENTIALS_BACK_HISTORY.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_KIT_CLAIMS)
                  .where(ESSENTIALS_KIT_CLAIMS.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_KIT_DELIVERIES)
                  .where(ESSENTIALS_KIT_DELIVERIES.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_TELEPORT_ATTEMPTS)
                  .where(ESSENTIALS_TELEPORT_ATTEMPTS.PAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_TELEPORT_CONFIRMATIONS)
                  .where(ESSENTIALS_TELEPORT_CONFIRMATIONS.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_TELEPORT_COOLDOWNS)
                  .where(ESSENTIALS_TELEPORT_COOLDOWNS.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_TELEPORT_STATE)
                  .where(ESSENTIALS_TELEPORT_STATE.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_TELEPORT_USES)
                  .where(ESSENTIALS_TELEPORT_USES.PLAYER.eq(id))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_MODERATION_LOG)
                  .where(
                      ESSENTIALS_MODERATION_LOG
                          .TARGET
                          .eq(id)
                          .or(ESSENTIALS_MODERATION_LOG.ACTOR.eq(id)))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_STAFF_STATE)
                  .where(
                      ESSENTIALS_STAFF_STATE.ID.eq(id),
                      ESSENTIALS_STAFF_STATE.KIND.in("jail", "session"))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_STAFF_AUDIT)
                  .where(
                      ESSENTIALS_STAFF_AUDIT
                          .ACTOR
                          .eq(id)
                          .or(ESSENTIALS_STAFF_AUDIT.TARGETS.like("%" + id + "%")))
                  .execute();
              dsl.deleteFrom(ESSENTIALS_PLAYERS).where(ESSENTIALS_PLAYERS.PLAYER.eq(id)).execute();
              return true;
            })
        .thenAccept(ignored -> {});
  }
}
