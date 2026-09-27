package com.shepherdjerred.thestorm.essentials.adapter.db;

import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_KIT_CLAIMS;
import static com.shepherdjerred.thestorm.essentials.adapter.db.generated.Tables.ESSENTIALS_KIT_DELIVERIES;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.store.KitClaimStore;
import com.shepherdjerred.thestorm.essentials.domain.kit.KitError;
import com.shepherdjerred.thestorm.essentials.domain.kit.KitRules;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link KitClaimStore} over {@code essentials_kit_claims}. */
public final class JooqKitClaimStore implements KitClaimStore {

  private final StormDatabase database;

  public JooqKitClaimStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Result<Instant, KitError>> claim(UUID player, KitClaim claim) {
    return database.write(
        dsl -> {
          var last =
              dsl.select(ESSENTIALS_KIT_CLAIMS.CLAIMED_AT)
                  .from(ESSENTIALS_KIT_CLAIMS)
                  .where(ESSENTIALS_KIT_CLAIMS.PLAYER.eq(player.toString()))
                  .and(ESSENTIALS_KIT_CLAIMS.KIT.eq(claim.name()))
                  .fetchOptional(row -> Instant.ofEpochMilli(row.value1()));
          var decision = KitRules.claim(claim.kit(), last, claim.at());
          if (decision instanceof Result.Ok<Instant, KitError>(var at)) {
            dsl.insertInto(ESSENTIALS_KIT_CLAIMS)
                .set(ESSENTIALS_KIT_CLAIMS.PLAYER, player.toString())
                .set(ESSENTIALS_KIT_CLAIMS.KIT, claim.name())
                .set(ESSENTIALS_KIT_CLAIMS.CLAIMED_AT, at.toEpochMilli())
                .onConflict(ESSENTIALS_KIT_CLAIMS.PLAYER, ESSENTIALS_KIT_CLAIMS.KIT)
                .doUpdate()
                .set(ESSENTIALS_KIT_CLAIMS.CLAIMED_AT, at.toEpochMilli())
                .execute();
            dsl.insertInto(ESSENTIALS_KIT_DELIVERIES)
                .set(ESSENTIALS_KIT_DELIVERIES.PLAYER, player.toString())
                .set(ESSENTIALS_KIT_DELIVERIES.KIT, claim.name())
                .set(ESSENTIALS_KIT_DELIVERIES.CLAIMED_AT, at.toEpochMilli())
                .execute();
          }
          return decision;
        });
  }

  @Override
  public CompletableFuture<List<PendingKit>> pending(UUID player) {
    return database.read(
        dsl ->
            dsl.selectFrom(ESSENTIALS_KIT_DELIVERIES)
                .where(ESSENTIALS_KIT_DELIVERIES.PLAYER.eq(player.toString()))
                .orderBy(ESSENTIALS_KIT_DELIVERIES.CLAIMED_AT, ESSENTIALS_KIT_DELIVERIES.KIT)
                .fetch(
                    row -> new PendingKit(row.getKit(), Instant.ofEpochMilli(row.getClaimedAt()))));
  }

  @Override
  public CompletableFuture<Void> acknowledge(UUID player, PendingKit pending) {
    return database
        .write(
            dsl ->
                dsl.deleteFrom(ESSENTIALS_KIT_DELIVERIES)
                    .where(ESSENTIALS_KIT_DELIVERIES.PLAYER.eq(player.toString()))
                    .and(ESSENTIALS_KIT_DELIVERIES.KIT.eq(pending.name()))
                    .and(
                        ESSENTIALS_KIT_DELIVERIES.CLAIMED_AT.eq(pending.claimedAt().toEpochMilli()))
                    .execute())
        .thenAccept(rows -> {});
  }
}
