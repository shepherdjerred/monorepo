package com.shepherdjerred.thestorm.mobs.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.mobs.MobsModule;
import com.shepherdjerred.thestorm.mobs.adapter.db.JooqBeginnerTimeStore;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class BeginnerTimeStoreTest {
  @TempDir Path directory;

  @Test
  void sqliteMigrationCheckpointsSurviveReopeningAndCannotMoveBackwards() {
    var path = directory.resolve("time.db");
    var player = UUID.fromString("00000000-0000-0000-0000-000000000001");
    try (var database = StormDatabase.open(path)) {
      database.migrate("mobs", MobsModule.class.getClassLoader());
      var store = new JooqBeginnerTimeStore(database);
      assertThat(store.load().join()).isEmpty();
      store.save(player, 60_000).join();
      store.save(player, 30_000).join();
    }
    try (var database = StormDatabase.open(path)) {
      var store = new JooqBeginnerTimeStore(database);
      assertThat(store.load().join()).containsEntry(player, 60_000L);
    }
  }
}
