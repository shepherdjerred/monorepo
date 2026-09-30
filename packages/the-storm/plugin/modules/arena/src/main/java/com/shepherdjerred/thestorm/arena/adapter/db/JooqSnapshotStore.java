package com.shepherdjerred.thestorm.arena.adapter.db;

import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SNAPSHOTS;
import static com.shepherdjerred.thestorm.arena.adapter.db.generated.Tables.ARENA_SNAPSHOT_EFFECTS;
import static java.util.stream.Collectors.groupingBy;

import com.shepherdjerred.thestorm.arena.adapter.db.generated.tables.records.ArenaSnapshotEffectsRecord;
import com.shepherdjerred.thestorm.arena.adapter.db.generated.tables.records.ArenaSnapshotsRecord;
import com.shepherdjerred.thestorm.arena.app.store.SnapshotStore;
import com.shepherdjerred.thestorm.arena.domain.snapshot.EffectRecord;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Experience;
import com.shepherdjerred.thestorm.arena.domain.snapshot.ItemData;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Position;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Snapshot;
import com.shepherdjerred.thestorm.arena.domain.snapshot.Vitals;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link SnapshotStore} over {@code arena_snapshots} and {@code arena_snapshot_effects}. */
public final class JooqSnapshotStore implements SnapshotStore {

  private final StormDatabase database;

  public JooqSnapshotStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> save(Snapshot snapshot) {
    return Writes.done(
        database.write(
            dsl -> {
              var player = snapshot.player().toString();
              dsl.deleteFrom(ARENA_SNAPSHOTS).where(ARENA_SNAPSHOTS.PLAYER.eq(player)).execute();
              var position = snapshot.position();
              var vitals = snapshot.vitals();
              var experience = snapshot.experience();
              dsl.insertInto(ARENA_SNAPSHOTS)
                  .set(ARENA_SNAPSHOTS.PLAYER, player)
                  .set(ARENA_SNAPSHOTS.ARENA, snapshot.arena())
                  .set(ARENA_SNAPSHOTS.WORLD, position.world())
                  .set(ARENA_SNAPSHOTS.X, position.x())
                  .set(ARENA_SNAPSHOTS.Y, position.y())
                  .set(ARENA_SNAPSHOTS.Z, position.z())
                  .set(ARENA_SNAPSHOTS.YAW, (double) position.yaw())
                  .set(ARENA_SNAPSHOTS.PITCH, (double) position.pitch())
                  .set(ARENA_SNAPSHOTS.HEALTH, vitals.health())
                  .set(ARENA_SNAPSHOTS.FOOD, vitals.food())
                  .set(ARENA_SNAPSHOTS.SATURATION, (double) vitals.saturation())
                  .set(ARENA_SNAPSHOTS.EXHAUSTION, (double) vitals.exhaustion())
                  .set(ARENA_SNAPSHOTS.GAME_MODE, vitals.gameMode())
                  .set(ARENA_SNAPSHOTS.LEVEL, experience.level())
                  .set(ARENA_SNAPSHOTS.PROGRESS, (double) experience.progress())
                  .set(ARENA_SNAPSHOTS.TOTAL_EXPERIENCE, experience.total())
                  .set(ARENA_SNAPSHOTS.INVENTORY, snapshot.inventory().bytes())
                  .set(ARENA_SNAPSHOTS.TAKEN_AT, snapshot.takenAt().toEpochMilli())
                  .execute();
              var effects = snapshot.effects();
              for (var i = 0; i < effects.size(); i++) {
                var effect = effects.get(i);
                dsl.insertInto(ARENA_SNAPSHOT_EFFECTS)
                    .set(ARENA_SNAPSHOT_EFFECTS.PLAYER, player)
                    .set(ARENA_SNAPSHOT_EFFECTS.POSITION, i)
                    .set(ARENA_SNAPSHOT_EFFECTS.EFFECT, effect.type())
                    .set(ARENA_SNAPSHOT_EFFECTS.AMPLIFIER, effect.amplifier())
                    .set(ARENA_SNAPSHOT_EFFECTS.DURATION, effect.duration())
                    .set(ARENA_SNAPSHOT_EFFECTS.AMBIENT, effect.ambient())
                    .set(ARENA_SNAPSHOT_EFFECTS.PARTICLES, effect.particles())
                    .set(ARENA_SNAPSHOT_EFFECTS.ICON, effect.icon())
                    .execute();
              }
              return true;
            }));
  }

  @Override
  public CompletableFuture<Boolean> markRestored(UUID player, Instant at) {
    return database.write(
        dsl ->
            dsl.update(ARENA_SNAPSHOTS)
                    .set(ARENA_SNAPSHOTS.RESTORED_AT, at.toEpochMilli())
                    .where(ARENA_SNAPSHOTS.PLAYER.eq(player.toString()))
                    .and(ARENA_SNAPSHOTS.RESTORED_AT.isNull())
                    .execute()
                > 0);
  }

  @Override
  public CompletableFuture<Void> deleteRestored(UUID player) {
    return Writes.done(
        database.write(
            dsl ->
                dsl.deleteFrom(ARENA_SNAPSHOTS)
                    .where(ARENA_SNAPSHOTS.PLAYER.eq(player.toString()))
                    .and(ARENA_SNAPSHOTS.RESTORED_AT.isNotNull())
                    .execute()));
  }

  @Override
  public CompletableFuture<List<Snapshot>> loadAll() {
    return database.read(
        dsl -> {
          Map<String, List<ArenaSnapshotEffectsRecord>> effects =
              dsl
                  .selectFrom(ARENA_SNAPSHOT_EFFECTS)
                  .orderBy(ARENA_SNAPSHOT_EFFECTS.PLAYER, ARENA_SNAPSHOT_EFFECTS.POSITION)
                  .fetch()
                  .stream()
                  .collect(groupingBy(ArenaSnapshotEffectsRecord::getPlayer));
          return dsl
              .selectFrom(ARENA_SNAPSHOTS)
              .where(ARENA_SNAPSHOTS.RESTORED_AT.isNull())
              .orderBy(ARENA_SNAPSHOTS.TAKEN_AT)
              .fetch()
              .stream()
              .map(row -> toSnapshot(row, effects.getOrDefault(row.getPlayer(), List.of())))
              .toList();
        });
  }

  private static Snapshot toSnapshot(
      ArenaSnapshotsRecord row, List<ArenaSnapshotEffectsRecord> effects) {
    return new Snapshot(
        UUID.fromString(row.getPlayer()),
        row.getArena(),
        new Position(
            row.getWorld(),
            row.getX(),
            row.getY(),
            row.getZ(),
            row.getYaw().floatValue(),
            row.getPitch().floatValue()),
        new Vitals(
            row.getHealth(),
            row.getFood(),
            row.getSaturation().floatValue(),
            row.getExhaustion().floatValue(),
            row.getGameMode()),
        new Experience(row.getLevel(), row.getProgress().floatValue(), row.getTotalExperience()),
        ItemData.of(row.getInventory()),
        effects.stream().map(JooqSnapshotStore::toEffect).toList(),
        Instant.ofEpochMilli(row.getTakenAt()));
  }

  private static EffectRecord toEffect(ArenaSnapshotEffectsRecord row) {
    return new EffectRecord(
        row.getEffect(),
        row.getAmplifier(),
        row.getDuration(),
        row.getAmbient(),
        row.getParticles(),
        row.getIcon());
  }
}
