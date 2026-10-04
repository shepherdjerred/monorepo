package com.shepherdjerred.thestorm.npcs.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.npcs.domain.combat.NpcLedger;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqNpcStateStoreTest {
  @TempDir Path directory;

  @Test
  void snapshotsCommitInOrderAndSurviveRestartWithoutResurrectingClearedState() throws Exception {
    var file = directory.resolve("npcs.db");
    var ledger = new NpcLedger();
    var alice = UUID.randomUUID();
    ledger.hit(new NpcLedger.Attack("minecraft:overworld", "nat", alice, 100), false);
    ledger.accuse("minecraft:overworld", alice, 100);
    ledger.died("minecraft:overworld", "nat", 100);
    var snapshot = ledger.snapshot();
    try (var database = StormDatabase.open(file)) {
      database.migrate("npcs", getClass().getClassLoader());
      var store = new JooqNpcStateStore(database);
      assertThat(await(store.load())).isEqualTo(NpcLedger.Snapshot.empty());
      await(store.save(snapshot));
    }
    try (var database = StormDatabase.open(file)) {
      database.migrate("npcs", getClass().getClassLoader());
      var store = new JooqNpcStateStore(database);
      assertThat(await(store.load())).isEqualTo(snapshot);
      var earlier = store.save(snapshot);
      var expired = store.save(NpcLedger.Snapshot.empty());
      await(earlier);
      await(expired);
      assertThat(await(store.load())).isEqualTo(NpcLedger.Snapshot.empty());
    }
  }

  @Test
  void corruptPlayerIdentityDoesNotBecomeAnEmptyAllowance() throws Exception {
    try (var database = StormDatabase.open(directory.resolve("corrupt.db"))) {
      database.migrate("npcs", getClass().getClassLoader());
      await(
          database.write(
              dsl ->
                  dsl.execute(
                      """
          INSERT INTO npc_wanted(world, player_uuid, until_tick)
          VALUES ('minecraft:overworld', 'invalid', 24000)
          """)));
      assertThatThrownBy(() -> await(new JooqNpcStateStore(database).load()))
          .hasRootCauseInstanceOf(IllegalArgumentException.class);
    }
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(10, TimeUnit.SECONDS);
  }
}
