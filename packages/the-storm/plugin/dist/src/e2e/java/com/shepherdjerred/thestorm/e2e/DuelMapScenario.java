package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.rwfbots.app.CombatHarness;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import org.bukkit.Location;
import org.bukkit.World;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Shared original terrain and controlled starting conditions, present only in native fixtures. */
record DuelMapScenario(
    int schema,
    String kind,
    String id,
    String map,
    String mapSha256,
    String world,
    Region region,
    List<String> sourceTeams,
    String spawnPolicy,
    List<Spawn> spawns) {
  private static final Contract CONTRACT = read("/rwf-map-scenario.json", Contract.class);
  private static final List<DuelMapScenario> SCENARIOS = registry();

  private record Contract(
      int version,
      String kind,
      String world,
      List<String> teamColors,
      List<String> fields,
      List<String> spawnFields) {}

  private record Registry(int schema, String kind, List<DuelMapScenario> scenarios) {}

  record Point(double x, double y, double z) {}

  record Region(Point min, Point max) {
    boolean contains(List<Double> position) {
      return position.get(0) >= min.x()
          && position.get(0) < max.x() + 1
          && position.get(1) >= min.y()
          && position.get(1) <= max.y()
          && position.get(2) >= min.z()
          && position.get(2) < max.z() + 1;
    }
  }

  record Spawn(String team, String sourceTeam, List<Double> position, float yaw, float pitch) {
    Spawn {
      position = List.copyOf(position);
      if (!Set.of("red", "blue").contains(team)
          || position.size() != 3
          || position.stream().anyMatch(value -> !Double.isFinite(value))
          || !Float.isFinite(yaw)
          || !Float.isFinite(pitch)
          || Math.abs(pitch) > 90)
        throw new IllegalArgumentException("Invalid native scenario spawn");
    }

    Location location(World world) {
      return new Location(world, position.get(0), position.get(1), position.get(2), yaw, pitch);
    }
  }

  DuelMapScenario {
    sourceTeams = List.copyOf(sourceTeams);
    spawns = List.copyOf(spawns);
    if (schema != CONTRACT.version()
        || !kind.equals(CONTRACT.kind())
        || !world.equals(CONTRACT.world())
        || !map.matches("[a-z0-9]+(?:-[a-z0-9]+)*")
        || !id.matches("[a-z0-9]+(?:-[a-z0-9]+)*")
        || !mapSha256.matches("[a-f0-9]{64}")
        || sourceTeams.size() < 2
        || sourceTeams.size() > 5
        || Set.copyOf(sourceTeams).size() != sourceTeams.size()
        || !CONTRACT.teamColors().containsAll(sourceTeams)
        || !Set.of("source", "authored").contains(spawnPolicy)
        || spawns.size() != 2
        || !spawns.stream().map(Spawn::team).toList().equals(List.of("red", "blue"))
        || spawns.stream().map(Spawn::sourceTeam).distinct().count() != 2)
      throw new IllegalArgumentException("Native map scenario differs from its contract");
    for (var spawn : spawns) {
      if (!sourceTeams.contains(spawn.sourceTeam()) || !region.contains(spawn.position()))
        throw new IllegalArgumentException("Native scenario spawn is outside its source map");
    }
  }

  Spawn spawn(String team) {
    return spawns.stream().filter(spawn -> spawn.team().equals(team)).findFirst().orElseThrow();
  }

  static DuelMapScenario forMap(String map) {
    return SCENARIOS.stream()
        .filter(scenario -> scenario.map().equals(map))
        .findFirst()
        .orElseThrow(() -> new IllegalArgumentException("No validated duel scenario for " + map));
  }

  private static List<DuelMapScenario> registry() {
    if (!CONTRACT.fields().equals(names(DuelMapScenario.class))
        || !CONTRACT.spawnFields().equals(names(Spawn.class)))
      throw new IllegalStateException("Native scenario fields differ from neutral contract");
    var registry = read("/rwf-map-scenarios.json", Registry.class);
    var scenarios = List.copyOf(registry.scenarios());
    if (registry.schema() != 1
        || !registry.kind().equals("rwf-map-scenarios")
        || scenarios.isEmpty()
        || scenarios.stream().map(DuelMapScenario::map).distinct().count() != scenarios.size())
      throw new IllegalStateException("Invalid native map scenario registry");
    return scenarios;
  }

  private static List<String> names(Class<?> type) {
    return Arrays.stream(type.getRecordComponents())
        .map(java.lang.reflect.RecordComponent::getName)
        .toList();
  }

  private static <T> T read(String resource, Class<T> type) {
    var json =
        JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .enable(DeserializationFeature.FAIL_ON_MISSING_CREATOR_PROPERTIES)
            .build();
    try (var source = CombatHarness.class.getResourceAsStream(resource)) {
      if (source == null) throw new IllegalStateException("Missing " + resource);
      return json.readValue(source, type);
    } catch (IOException failure) {
      throw new IllegalStateException("Unreadable " + resource, failure);
    }
  }
}
