package com.shepherdjerred.thestorm.rwf.adapter.db;

import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_SNAPSHOTS;
import static com.shepherdjerred.thestorm.rwf.adapter.db.generated.Tables.RWF_SNAPSHOT_EFFECTS;
import static java.util.stream.Collectors.groupingBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.snapshot.EffectRecord;
import com.shepherdjerred.thestorm.core.snapshot.Experience;
import com.shepherdjerred.thestorm.core.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.snapshot.Position;
import com.shepherdjerred.thestorm.core.snapshot.Snapshot;
import com.shepherdjerred.thestorm.core.snapshot.SnapshotStore;
import com.shepherdjerred.thestorm.core.snapshot.Vitals;
import com.shepherdjerred.thestorm.rwf.adapter.db.generated.tables.records.RwfSnapshotEffectsRecord;
import com.shepherdjerred.thestorm.rwf.adapter.db.generated.tables.records.RwfSnapshotsRecord;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link SnapshotStore} over {@code rwf_snapshots} and {@code rwf_snapshot_effects}. */
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
              dsl.deleteFrom(RWF_SNAPSHOTS).where(RWF_SNAPSHOTS.PLAYER.eq(player)).execute();
              var position = snapshot.position();
              var vitals = snapshot.vitals();
              var experience = snapshot.experience();
              dsl.insertInto(RWF_SNAPSHOTS)
                  .set(RWF_SNAPSHOTS.PLAYER, player)
                  .set(RWF_SNAPSHOTS.SCOPE, snapshot.scope())
                  .set(RWF_SNAPSHOTS.WORLD, position.world())
                  .set(RWF_SNAPSHOTS.X, position.x())
                  .set(RWF_SNAPSHOTS.Y, position.y())
                  .set(RWF_SNAPSHOTS.Z, position.z())
                  .set(RWF_SNAPSHOTS.YAW, (double) position.yaw())
                  .set(RWF_SNAPSHOTS.PITCH, (double) position.pitch())
                  .set(RWF_SNAPSHOTS.HEALTH, vitals.health())
                  .set(RWF_SNAPSHOTS.FOOD, vitals.food())
                  .set(RWF_SNAPSHOTS.SATURATION, (double) vitals.saturation())
                  .set(RWF_SNAPSHOTS.EXHAUSTION, (double) vitals.exhaustion())
                  .set(RWF_SNAPSHOTS.GAME_MODE, vitals.gameMode())
                  .set(RWF_SNAPSHOTS.LEVEL, experience.level())
                  .set(RWF_SNAPSHOTS.PROGRESS, (double) experience.progress())
                  .set(RWF_SNAPSHOTS.TOTAL_EXPERIENCE, experience.total())
                  .set(RWF_SNAPSHOTS.INVENTORY, snapshot.inventory().bytes())
                  .set(RWF_SNAPSHOTS.TAKEN_AT, snapshot.takenAt().toEpochMilli())
                  .execute();
              var effects = snapshot.effects();
              for (var i = 0; i < effects.size(); i++) {
                var effect = effects.get(i);
                dsl.insertInto(RWF_SNAPSHOT_EFFECTS)
                    .set(RWF_SNAPSHOT_EFFECTS.PLAYER, player)
                    .set(RWF_SNAPSHOT_EFFECTS.POSITION, i)
                    .set(RWF_SNAPSHOT_EFFECTS.EFFECT, effect.type())
                    .set(RWF_SNAPSHOT_EFFECTS.AMPLIFIER, effect.amplifier())
                    .set(RWF_SNAPSHOT_EFFECTS.DURATION, effect.duration())
                    .set(RWF_SNAPSHOT_EFFECTS.AMBIENT, effect.ambient())
                    .set(RWF_SNAPSHOT_EFFECTS.PARTICLES, effect.particles())
                    .set(RWF_SNAPSHOT_EFFECTS.ICON, effect.icon())
                    .execute();
              }
              return true;
            }));
  }

  @Override
  public CompletableFuture<Boolean> markRestored(UUID player, Instant at) {
    return database.write(
        dsl ->
            dsl.update(RWF_SNAPSHOTS)
                    .set(RWF_SNAPSHOTS.RESTORED_AT, at.toEpochMilli())
                    .where(RWF_SNAPSHOTS.PLAYER.eq(player.toString()))
                    .and(RWF_SNAPSHOTS.RESTORED_AT.isNull())
                    .execute()
                > 0);
  }

  @Override
  public CompletableFuture<Void> deleteRestored(UUID player) {
    return Writes.done(
        database.write(
            dsl ->
                dsl.deleteFrom(RWF_SNAPSHOTS)
                    .where(RWF_SNAPSHOTS.PLAYER.eq(player.toString()))
                    .and(RWF_SNAPSHOTS.RESTORED_AT.isNotNull())
                    .execute()));
  }

  @Override
  public CompletableFuture<List<Snapshot>> loadAll() {
    return database.read(
        dsl -> {
          Map<String, List<RwfSnapshotEffectsRecord>> effects =
              dsl
                  .selectFrom(RWF_SNAPSHOT_EFFECTS)
                  .orderBy(RWF_SNAPSHOT_EFFECTS.PLAYER, RWF_SNAPSHOT_EFFECTS.POSITION)
                  .fetch()
                  .stream()
                  .collect(groupingBy(RwfSnapshotEffectsRecord::getPlayer));
          return dsl
              .selectFrom(RWF_SNAPSHOTS)
              .where(RWF_SNAPSHOTS.RESTORED_AT.isNull())
              .orderBy(RWF_SNAPSHOTS.TAKEN_AT)
              .fetch()
              .stream()
              .map(row -> toSnapshot(row, effects.getOrDefault(row.getPlayer(), List.of())))
              .toList();
        });
  }

  private static Snapshot toSnapshot(
      RwfSnapshotsRecord row, List<RwfSnapshotEffectsRecord> effects) {
    return new Snapshot(
        UUID.fromString(row.getPlayer()),
        row.getScope(),
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

  private static EffectRecord toEffect(RwfSnapshotEffectsRecord row) {
    return new EffectRecord(
        row.getEffect(),
        row.getAmplifier(),
        row.getDuration(),
        row.getAmbient(),
        row.getParticles(),
        row.getIcon());
  }
}
