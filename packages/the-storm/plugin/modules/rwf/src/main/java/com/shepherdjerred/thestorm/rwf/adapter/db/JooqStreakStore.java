package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_STREAK_PREFS;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.rwf.app.store.StreakStore;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.StreakLoadout;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Typed, asynchronous preferences over the RWF-owned reward table. */
public final class JooqStreakStore implements StreakStore {
  private final StormDatabase database;

  public JooqStreakStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Optional<StreakLoadout>> load(UUID player) {
    return database.read(
        dsl ->
            dsl.selectFrom(RWF_STREAK_PREFS)
                .where(RWF_STREAK_PREFS.PLAYER.eq(player.toString()))
                .fetchOptional()
                .map(
                    row ->
                        new StreakLoadout(
                            List.of(
                                Killstreak.valueOf(row.getReward_1()),
                                Killstreak.valueOf(row.getReward_2()),
                                Killstreak.valueOf(row.getReward_3())))));
  }

  @Override
  public CompletableFuture<Void> save(UUID player, StreakLoadout loadout) {
    var rewards = loadout.rewards();
    return Writes.done(
        database.write(
            dsl ->
                dsl.insertInto(RWF_STREAK_PREFS)
                    .set(RWF_STREAK_PREFS.PLAYER, player.toString())
                    .set(RWF_STREAK_PREFS.REWARD_1, rewards.get(0).name())
                    .set(RWF_STREAK_PREFS.REWARD_2, rewards.get(1).name())
                    .set(RWF_STREAK_PREFS.REWARD_3, rewards.get(2).name())
                    .onConflict(RWF_STREAK_PREFS.PLAYER)
                    .doUpdate()
                    .set(RWF_STREAK_PREFS.REWARD_1, rewards.get(0).name())
                    .set(RWF_STREAK_PREFS.REWARD_2, rewards.get(1).name())
                    .set(RWF_STREAK_PREFS.REWARD_3, rewards.get(2).name())
                    .execute()));
  }
}
