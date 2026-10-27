package com.shepherdjerred.thestorm.reset.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.nio.file.Path;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqResetStoreTest {

  @Test
  void pendingMarkersAreIdempotentAndSurviveReopen(@TempDir Path directory) throws Exception {
    var player = UUID.randomUUID();
    try (var database = StormDatabase.open(directory.resolve("reset.db"))) {
      database.migrate("reset", getClass().getClassLoader());
      var store = new JooqResetStore(database);
      await(store.begin(player, Instant.EPOCH));
      await(store.begin(player, Instant.EPOCH.plusSeconds(1)));

      assertThat(await(store.isPending(player))).isTrue();
      assertThat(await(store.pending())).containsExactly(player);
    }
    try (var database = StormDatabase.open(directory.resolve("reset.db"))) {
      database.migrate("reset", getClass().getClassLoader());
      var store = new JooqResetStore(database);
      assertThat(await(store.pending())).containsExactly(player);
      await(store.finish(player));
      await(store.finish(player));
      assertThat(await(store.isPending(player))).isFalse();
    }
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }
}
