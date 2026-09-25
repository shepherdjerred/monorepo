package com.shepherdjerred.thestorm.arena.adapter.db;

import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_PENDING_REWARDS;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_VAULT_CLAIMS;

import com.shepherdjerred.thestorm.arena.app.store.RewardStore;
import com.shepherdjerred.thestorm.arena.domain.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.time.Instant;
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
  public CompletableFuture<List<PendingReward>> claimAll(UUID player) {
    return database.write(
        dsl -> {
          var claimed =
              dsl.selectFrom(ARENA_PENDING_REWARDS)
                  .where(ARENA_PENDING_REWARDS.PLAYER.eq(player.toString()))
                  .orderBy(ARENA_PENDING_REWARDS.ID)
                  .fetch(
                      row ->
                          new PendingReward(
                              row.getId(), row.getReason(), ItemData.of(row.getItems())));
          dsl.deleteFrom(ARENA_PENDING_REWARDS)
              .where(ARENA_PENDING_REWARDS.PLAYER.eq(player.toString()))
              .and(
                  ARENA_PENDING_REWARDS.ID.in(
                      claimed.stream().map(reward -> Math.toIntExact(reward.id())).toList()))
              .execute();
          return claimed;
        });
  }

  @Override
  public CompletableFuture<Void> requeue(UUID player, List<PendingReward> rewards, Instant at) {
    return Writes.done(
        database.write(
            dsl -> {
              for (var reward : rewards) {
                dsl.insertInto(ARENA_PENDING_REWARDS)
                    .set(ARENA_PENDING_REWARDS.PLAYER, player.toString())
                    .set(ARENA_PENDING_REWARDS.REASON, reward.reason())
                    .set(ARENA_PENDING_REWARDS.ITEMS, reward.items().bytes())
                    .set(ARENA_PENDING_REWARDS.CREATED_AT, at.toEpochMilli())
                    .execute();
              }
              return rewards.size();
            }));
  }
}
