package com.shepherdjerred.thestorm.npcs.adapter.db;

import static com.shepherdjerred.thestorm.npcs.adapter.db.generated.Tables.NPC_DEATH;
import static com.shepherdjerred.thestorm.npcs.adapter.db.generated.Tables.NPC_WANTED;
import static com.shepherdjerred.thestorm.npcs.adapter.db.generated.Tables.NPC_WARNING;
import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.npcs.app.NpcStateStore;
import com.shepherdjerred.thestorm.npcs.domain.combat.NpcLedger.Death;
import com.shepherdjerred.thestorm.npcs.domain.combat.NpcLedger.Snapshot;
import com.shepherdjerred.thestorm.npcs.domain.combat.NpcLedger.Wanted;
import com.shepherdjerred.thestorm.npcs.domain.combat.NpcLedger.Warning;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Atomic snapshots on the shared SQLite writer; no database calls run on Paper's main thread. */
public final class JooqNpcStateStore implements NpcStateStore {
  private final StormDatabase database;

  public JooqNpcStateStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Snapshot> load() {
    return database.read(
        connection ->
            connection.transactionResult(
                transaction -> {
                  var dsl = transaction.dsl();
                  return new Snapshot(
                      dsl.selectFrom(NPC_WARNING)
                          .fetch(
                              row ->
                                  new Warning(
                                      requireNonNull(row.getWorld()),
                                      requireNonNull(row.getNpc()),
                                      UUID.fromString(requireNonNull(row.getPlayerUuid())),
                                      requireNonNull(row.getHits()),
                                      requireNonNull(row.getUntilTick()))),
                      dsl.selectFrom(NPC_WANTED)
                          .fetch(
                              row ->
                                  new Wanted(
                                      requireNonNull(row.getWorld()),
                                      UUID.fromString(requireNonNull(row.getPlayerUuid())),
                                      requireNonNull(row.getUntilTick()))),
                      dsl.selectFrom(NPC_DEATH)
                          .fetch(
                              row ->
                                  new Death(
                                      requireNonNull(row.getWorld()),
                                      requireNonNull(row.getNpc()),
                                      requireNonNull(row.getUntilTick()))));
                }));
  }

  @Override
  public CompletableFuture<Void> save(Snapshot snapshot) {
    return database
        .write(
            dsl -> {
              dsl.deleteFrom(NPC_WARNING).execute();
              dsl.deleteFrom(NPC_WANTED).execute();
              dsl.deleteFrom(NPC_DEATH).execute();
              for (var warning : snapshot.warnings()) {
                dsl.insertInto(NPC_WARNING)
                    .set(NPC_WARNING.WORLD, warning.world())
                    .set(NPC_WARNING.NPC, warning.npc())
                    .set(NPC_WARNING.PLAYER_UUID, warning.player().toString())
                    .set(NPC_WARNING.HITS, warning.hits())
                    .set(NPC_WARNING.UNTIL_TICK, warning.until())
                    .execute();
              }
              for (var offender : snapshot.wanted()) {
                dsl.insertInto(NPC_WANTED)
                    .set(NPC_WANTED.WORLD, offender.world())
                    .set(NPC_WANTED.PLAYER_UUID, offender.player().toString())
                    .set(NPC_WANTED.UNTIL_TICK, offender.until())
                    .execute();
              }
              for (var death : snapshot.deaths()) {
                dsl.insertInto(NPC_DEATH)
                    .set(NPC_DEATH.NPC, death.npc())
                    .set(NPC_DEATH.WORLD, death.world())
                    .set(NPC_DEATH.UNTIL_TICK, death.until())
                    .execute();
              }
              return Boolean.TRUE;
            })
        .thenAccept(done -> {});
  }
}
