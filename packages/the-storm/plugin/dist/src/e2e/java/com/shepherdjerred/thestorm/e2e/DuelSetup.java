package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Original starting conditions, sampled on Paper before either body acts; fixtures jar only. */
record DuelSetup(
    int schema,
    String kind,
    UUID match,
    long seed,
    String side,
    String mode,
    String opponent,
    String map,
    String world,
    long worldTime,
    long worldTick,
    List<Fighter> roster) {
  private static final Spec SPEC = load();

  record Fighter(
      int joinIndex,
      UUID body,
      String personality,
      String team,
      String kit,
      List<Double> position,
      List<Double> velocity,
      float yaw,
      float pitch,
      double health,
      int heldSlot) {
    Fighter {
      position = List.copyOf(position);
      velocity = List.copyOf(velocity);
    }
  }

  record Spawn(String team, List<Double> position, float yaw, float pitch) {
    Location location(World world) {
      return new Location(world, position.get(0), position.get(1), position.get(2), yaw, pitch);
    }
  }

  private record Spec(
      int version,
      String kind,
      String map,
      String world,
      List<Long> worldTimes,
      String kit,
      double health,
      int heldSlot,
      List<Double> velocity,
      List<String> fields,
      List<String> fighter,
      List<Spawn> spawns) {}

  DuelSetup {
    roster = List.copyOf(roster);
    if (schema != SPEC.version()
        || !kind.equals(SPEC.kind())
        || !map.equals(SPEC.map())
        || !world.equals(SPEC.world())
        || !SPEC.worldTimes().contains(worldTime)
        || worldTick < 0
        || roster.size() != 2
        || roster.stream().map(Fighter::body).distinct().count() != 2
        || roster.stream().map(Fighter::personality).distinct().count() != 2
        || !Set.copyOf(roster.stream().map(Fighter::team).toList()).equals(Set.of("red", "blue")))
      throw new IllegalStateException("Native duel setup differs from its contract");
    for (int index = 0; index < roster.size(); index++) {
      var fighter = roster.get(index);
      var spawn = spawn(fighter.team());
      if (fighter.joinIndex() != index
          || fighter.personality().isBlank()
          || !fighter.kit().equals(SPEC.kit())
          || !fighter.position().equals(spawn.position())
          || !fighter.velocity().equals(SPEC.velocity())
          || fighter.yaw() != spawn.yaw()
          || fighter.pitch() != spawn.pitch()
          || fighter.health() != SPEC.health()
          || fighter.heldSlot() != SPEC.heldSlot())
        throw new IllegalStateException("Native duel fighter setup changed");
    }
  }

  static Spawn spawn(String team) {
    return SPEC.spawns().stream()
        .filter(spawn -> spawn.team().equals(team))
        .findFirst()
        .orElseThrow();
  }

  static DuelSetup capture(
      MatchState match,
      long seed,
      String side,
      String mode,
      String opponent,
      Function<UUID, Player> bodies) {
    if (match.phase() != MatchState.Phase.LIVE || match.combatants().size() != 2)
      throw new IllegalStateException("Native setup requires the original live duel");
    var roster = new ArrayList<Fighter>();
    for (var fighter : match.combatants()) {
      var player = bodies.apply(fighter.uuid());
      if (!player.getWorld().getKey().asString().equals(SPEC.world()))
        throw new IllegalStateException("Native fighter world changed");
      var at = player.getLocation();
      var velocity = player.getVelocity();
      roster.add(
          new Fighter(
              roster.size(),
              fighter.uuid(),
              fighter.personalityId().orElseThrow(),
              fighter.team().orElseThrow(),
              fighter.kit().orElseThrow(),
              List.of(at.getX(), at.getY(), at.getZ()),
              List.of(velocity.getX(), velocity.getY(), velocity.getZ()),
              at.getYaw(),
              at.getPitch(),
              player.getHealth(),
              player.getInventory().getHeldItemSlot()));
    }
    var world = bodies.apply(roster.getFirst().body()).getWorld();
    return new DuelSetup(
        SPEC.version(),
        SPEC.kind(),
        match.matchId(),
        seed,
        side,
        mode,
        opponent,
        match.mapId().orElseThrow(),
        world.getKey().asString(),
        world.getTime(),
        world.getGameTime(),
        roster);
  }

  private static Spec load() {
    var json =
        JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .build();
    try (var source = CombatHarness.class.getResourceAsStream("/rwf-duel-setup.json")) {
      if (source == null) throw new IllegalStateException("Native duel setup contract missing");
      var spec = json.readValue(source, Spec.class);
      if (spec.version() != 1
          || !spec.kind().equals("rwf-native-duel-setup")
          || !spec.fields().equals(names(DuelSetup.class))
          || !spec.fighter().equals(names(Fighter.class))
          || !spec.spawns().stream().map(Spawn::team).toList().equals(List.of("red", "blue")))
        throw new IllegalStateException("Native duel setup contract is incompatible");
      return spec;
    } catch (IOException failure) {
      throw new IllegalStateException("Native duel setup contract unreadable", failure);
    }
  }

  private static List<String> names(Class<?> type) {
    return Arrays.stream(type.getRecordComponents())
        .map(java.lang.reflect.RecordComponent::getName)
        .toList();
  }
}
