package com.shepherdjerred.thestorm.creative.adapter.db;

import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_BODIES;
import static com.shepherdjerred.thestorm.creative.adapter.db.generated.Tables.CREATIVE_BODY_EFFECTS;
import static java.util.stream.Collectors.groupingBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.snapshot.EffectRecord;
import com.shepherdjerred.thestorm.core.snapshot.Experience;
import com.shepherdjerred.thestorm.core.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.snapshot.Position;
import com.shepherdjerred.thestorm.core.snapshot.Snapshot;
import com.shepherdjerred.thestorm.core.snapshot.Vitals;
import com.shepherdjerred.thestorm.creative.adapter.db.generated.tables.records.CreativeBodiesRecord;
import com.shepherdjerred.thestorm.creative.adapter.db.generated.tables.records.CreativeBodyEffectsRecord;
import com.shepherdjerred.thestorm.creative.app.BodyStore;
import com.shepherdjerred.thestorm.creative.app.VisitBody;
import com.shepherdjerred.thestorm.creative.domain.BodyRole;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** {@link BodyStore} over {@code creative_bodies} and {@code creative_body_effects}. */
public final class JooqBodyStore implements BodyStore {

  private final StormDatabase database;

  public JooqBodyStore(StormDatabase database) {
    this.database = database;
  }

  @Override
  public CompletableFuture<Void> save(VisitBody body) {
    return done(
        database.write(
            dsl -> {
              var player = body.snapshot().player().toString();
              var role = body.role().wire();
              dsl.deleteFrom(CREATIVE_BODIES)
                  .where(CREATIVE_BODIES.PLAYER.eq(player))
                  .and(CREATIVE_BODIES.ROLE.eq(role))
                  .execute();
              var position = body.snapshot().position();
              var vitals = body.snapshot().vitals();
              var experience = body.snapshot().experience();
              dsl.insertInto(CREATIVE_BODIES)
                  .set(CREATIVE_BODIES.PLAYER, player)
                  .set(CREATIVE_BODIES.ROLE, role)
                  .set(CREATIVE_BODIES.WORLD, position.world())
                  .set(CREATIVE_BODIES.X, position.x())
                  .set(CREATIVE_BODIES.Y, position.y())
                  .set(CREATIVE_BODIES.Z, position.z())
                  .set(CREATIVE_BODIES.YAW, (double) position.yaw())
                  .set(CREATIVE_BODIES.PITCH, (double) position.pitch())
                  .set(CREATIVE_BODIES.HEALTH, vitals.health())
                  .set(CREATIVE_BODIES.FOOD, vitals.food())
                  .set(CREATIVE_BODIES.SATURATION, (double) vitals.saturation())
                  .set(CREATIVE_BODIES.EXHAUSTION, (double) vitals.exhaustion())
                  .set(CREATIVE_BODIES.GAME_MODE, vitals.gameMode())
                  .set(CREATIVE_BODIES.ALLOW_FLIGHT, vitals.allowFlight())
                  .set(CREATIVE_BODIES.FLYING, vitals.flying())
                  .set(CREATIVE_BODIES.FLY_SPEED, (double) vitals.flySpeed())
                  .set(CREATIVE_BODIES.MAXIMUM_NO_DAMAGE_TICKS, vitals.maximumNoDamageTicks())
                  .set(CREATIVE_BODIES.VITALS_VERSION, vitals.formatVersion())
                  .set(CREATIVE_BODIES.LEVEL, experience.level())
                  .set(CREATIVE_BODIES.PROGRESS, (double) experience.progress())
                  .set(CREATIVE_BODIES.TOTAL_EXPERIENCE, experience.total())
                  .set(CREATIVE_BODIES.INVENTORY, body.snapshot().inventory().bytes())
                  .set(CREATIVE_BODIES.ENDER_CHEST, body.enderChest().bytes())
                  .set(CREATIVE_BODIES.TAKEN_AT, body.snapshot().takenAt().toEpochMilli())
                  .execute();
              var effects = body.snapshot().effects();
              for (var i = 0; i < effects.size(); i++) {
                var effect = effects.get(i);
                dsl.insertInto(CREATIVE_BODY_EFFECTS)
                    .set(CREATIVE_BODY_EFFECTS.PLAYER, player)
                    .set(CREATIVE_BODY_EFFECTS.ROLE, role)
                    .set(CREATIVE_BODY_EFFECTS.POSITION, i)
                    .set(CREATIVE_BODY_EFFECTS.EFFECT, effect.type())
                    .set(CREATIVE_BODY_EFFECTS.AMPLIFIER, effect.amplifier())
                    .set(CREATIVE_BODY_EFFECTS.DURATION, effect.duration())
                    .set(CREATIVE_BODY_EFFECTS.AMBIENT, effect.ambient())
                    .set(CREATIVE_BODY_EFFECTS.PARTICLES, effect.particles())
                    .set(CREATIVE_BODY_EFFECTS.ICON, effect.icon())
                    .execute();
              }
              return true;
            }));
  }

  @Override
  public CompletableFuture<List<VisitBody>> load(UUID player) {
    return database.read(
        dsl -> {
          var id = player.toString();
          Map<EffectKey, List<CreativeBodyEffectsRecord>> effects =
              dsl
                  .selectFrom(CREATIVE_BODY_EFFECTS)
                  .where(CREATIVE_BODY_EFFECTS.PLAYER.eq(id))
                  .orderBy(CREATIVE_BODY_EFFECTS.ROLE, CREATIVE_BODY_EFFECTS.POSITION)
                  .fetch()
                  .stream()
                  .collect(groupingBy(JooqBodyStore::effectKey));
          return dsl
              .selectFrom(CREATIVE_BODIES)
              .where(CREATIVE_BODIES.PLAYER.eq(id))
              .orderBy(CREATIVE_BODIES.ROLE.desc())
              .fetch()
              .stream()
              .map(
                  row ->
                      toBody(
                          row,
                          effects.getOrDefault(
                              new EffectKey(
                                  column(row.getPlayer(), "player"), column(row.getRole(), "role")),
                              List.of())))
              .toList();
        });
  }

  @Override
  public CompletableFuture<Void> delete(UUID player) {
    return done(
        database.write(
            dsl ->
                dsl.deleteFrom(CREATIVE_BODIES)
                    .where(CREATIVE_BODIES.PLAYER.eq(player.toString()))
                    .execute()));
  }

  @Override
  public CompletableFuture<Void> delete(UUID player, BodyRole role) {
    return done(
        database.write(
            dsl ->
                dsl.deleteFrom(CREATIVE_BODIES)
                    .where(CREATIVE_BODIES.PLAYER.eq(player.toString()))
                    .and(CREATIVE_BODIES.ROLE.eq(role.wire()))
                    .execute()));
  }

  private static EffectKey effectKey(CreativeBodyEffectsRecord row) {
    return new EffectKey(column(row.getPlayer(), "player"), column(row.getRole(), "role"));
  }

  private static VisitBody toBody(
      CreativeBodiesRecord row, List<CreativeBodyEffectsRecord> effects) {
    var role = BodyRole.parse(column(row.getRole(), "role"));
    var vitals =
        new Vitals(
            new Vitals.Condition(
                column(row.getHealth(), "health"),
                column(row.getFood(), "food"),
                column(row.getSaturation(), "saturation").floatValue(),
                column(row.getExhaustion(), "exhaustion").floatValue()),
            column(row.getGameMode(), "game_mode"),
            new Vitals.Flight(
                column(row.getAllowFlight(), "allow_flight"),
                column(row.getFlying(), "flying"),
                column(row.getFlySpeed(), "fly_speed").floatValue()),
            column(row.getMaximumNoDamageTicks(), "maximum_no_damage_ticks"),
            column(row.getVitalsVersion(), "vitals_version"));
    var snapshot =
        new Snapshot(
            UUID.fromString(column(row.getPlayer(), "player")),
            role.wire(),
            new Position(
                column(row.getWorld(), "world"),
                column(row.getX(), "x"),
                column(row.getY(), "y"),
                column(row.getZ(), "z"),
                column(row.getYaw(), "yaw").floatValue(),
                column(row.getPitch(), "pitch").floatValue()),
            vitals,
            new Experience(
                column(row.getLevel(), "level"),
                column(row.getProgress(), "progress").floatValue(),
                column(row.getTotalExperience(), "total_experience")),
            ItemData.of(column(row.getInventory(), "inventory")),
            effects.stream().map(JooqBodyStore::toEffect).toList(),
            Instant.ofEpochMilli(column(row.getTakenAt(), "taken_at")));
    return new VisitBody(role, snapshot, ItemData.of(column(row.getEnderChest(), "ender_chest")));
  }

  private static EffectRecord toEffect(CreativeBodyEffectsRecord row) {
    return new EffectRecord(
        column(row.getEffect(), "effect"),
        column(row.getAmplifier(), "amplifier"),
        column(row.getDuration(), "duration"),
        column(row.getAmbient(), "ambient"),
        column(row.getParticles(), "particles"),
        column(row.getIcon(), "icon"));
  }

  private static <T> T column(T value, String name) {
    if (value == null) {
      throw new IllegalStateException("creative body column " + name + " is null");
    }
    return value;
  }

  private static CompletableFuture<Void> done(CompletableFuture<?> write) {
    return write.thenAccept(result -> {});
  }

  private record EffectKey(String player, String role) {}
}
