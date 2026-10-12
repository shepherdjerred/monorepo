package com.shepherdjerred.thestorm.arena.adapter.db;

import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_PENDING_REWARDS;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_VAULT_CLAIMS;

import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.snapshot.ItemData;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link RewardStore} over {@code arena_vault_claims} and {@code arena_pending_rewards}. */
public final class JooqRewardStore implements RewardStore {

  private final StormDatabase database;

  public JooqRewardStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Claim> claimVault(VaultClaim claim) {
    return database.write(
        dsl -> {
          var player = claim.player().toString();
          var inserted =
              dsl.insertInto(ARENA_VAULT_CLAIMS)
                  .set(ARENA_VAULT_CLAIMS.PLAYER, player)
                  .set(ARENA_VAULT_CLAIMS.WAVE, claim.wave())
                  .set(ARENA_VAULT_CLAIMS.DAY, claim.day().toString())
                  .set(ARENA_VAULT_CLAIMS.CLAIMED_AT, claim.at().toEpochMilli())
                  .onConflictDoNothing()
                  .execute();
          if (inserted == 0) {
            return Claim.ALREADY_OPENED;
          }
          dsl.insertInto(ARENA_PENDING_REWARDS)
              .set(ARENA_PENDING_REWARDS.PLAYER, player)
              .set(ARENA_PENDING_REWARDS.REASON, "vault:wave" + claim.wave())
              .set(ARENA_PENDING_REWARDS.ITEMS, claim.loot().bytes())
              .set(ARENA_PENDING_REWARDS.CREATED_AT, claim.at().toEpochMilli())
              .execute();
          return Claim.OPENED;
        });
  }

  @Override
  public CompletableFuture<List<PendingReward>> pending(UUID player) {
    return database.read(
        dsl -> {
          return dsl.selectFrom(ARENA_PENDING_REWARDS)
              .where(ARENA_PENDING_REWARDS.PLAYER.eq(player.toString()))
              .orderBy(ARENA_PENDING_REWARDS.ID)
              .fetch(
                  row ->
                      new PendingReward(row.getId(), row.getReason(), ItemData.of(row.getItems())));
        });
  }

  @Override
  public CompletableFuture<Void> acknowledge(UUID player, List<Long> ids) {
    if (ids.isEmpty()) {
      return CompletableFuture.completedFuture(null);
    }
    return Writes.done(
        database.write(
            dsl ->
                dsl.deleteFrom(ARENA_PENDING_REWARDS)
                    .where(ARENA_PENDING_REWARDS.PLAYER.eq(player.toString()))
                    .and(ARENA_PENDING_REWARDS.ID.in(ids.stream().map(Math::toIntExact).toList()))
                    .execute()));
  }
}
