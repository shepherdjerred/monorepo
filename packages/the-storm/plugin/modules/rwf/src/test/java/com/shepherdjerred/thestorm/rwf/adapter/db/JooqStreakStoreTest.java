package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_STREAK_PREFS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.StreakLoadout;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqStreakStoreTest {
  @TempDir Path directory;
  private static final UUID PLAYER = new UUID(0, 41);

  @Test
  void absenceAndStoredPreferencesRemainDistinctAcrossRestarts() {
    var file = directory.resolve("streaks.db");
    var selected =
        new StreakLoadout(List.of(Killstreak.WOLVES, Killstreak.IRON_GOLEM, Killstreak.NAPALM));
    try (var database = StormDatabase.open(file)) {
      database.migrate("rwf", getClass().getClassLoader());
      var store = new JooqStreakStore(database);
      assertThat(store.load(PLAYER).join()).isEmpty();
      store.save(PLAYER, StreakLoadout.DEFAULT).join();
      store.save(PLAYER, selected).join();
    }
    try (var database = StormDatabase.open(file)) {
      database.migrate("rwf", getClass().getClassLoader());
      assertThat(new JooqStreakStore(database).load(PLAYER).join()).contains(selected);
    }
  }

  @Test
  void unknownRewardsAndDuplicateThresholdsFailRatherThanUseDefaults() {
    try (var database = StormDatabase.open(directory.resolve("corrupt.db"))) {
      database.migrate("rwf", getClass().getClassLoader());
      var store = new JooqStreakStore(database);
      store.save(PLAYER, StreakLoadout.DEFAULT).join();
      database
          .write(
              dsl ->
                  dsl.update(RWF_STREAK_PREFS)
                      .set(RWF_STREAK_PREFS.REWARD_2, "UNKNOWN")
                      .where(RWF_STREAK_PREFS.PLAYER.eq(PLAYER.toString()))
                      .execute())
          .join();
      assertThatThrownBy(() -> store.load(PLAYER).join())
          .hasCauseInstanceOf(IllegalArgumentException.class);
      database
          .write(
              dsl ->
                  dsl.update(RWF_STREAK_PREFS)
                      .set(RWF_STREAK_PREFS.REWARD_1, "SUPPLY_CRATE")
                      .set(RWF_STREAK_PREFS.REWARD_2, "WOLVES")
                      .where(RWF_STREAK_PREFS.PLAYER.eq(PLAYER.toString()))
                      .execute())
          .join();
      assertThatThrownBy(() -> store.load(PLAYER).join())
          .hasCauseInstanceOf(IllegalArgumentException.class);
    }
  }
}
