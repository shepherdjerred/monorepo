package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionBundle.expect;
import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionGates.require;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import tools.jackson.databind.JsonNode;

/** Frozen map identities and the same neutral strength schedule used by Python and TypeScript. */
final class PromotionMaps {
  private static final JsonNode MAPS = resource("/rwf-training-maps.json");
  private static final JsonNode EVALUATION = resource("/rwf-strength-evaluation.json");

  record Binding(String map, String blocksSha256, String scenarioSha256) {}

  record Matchup(Binding binding, String opponent, int seed, String side) {}

  static {
    expect(MAPS, "schema", 1);
    expect(MAPS, "kind", "rwf-training-maps");
    expect(MAPS, "selection", "paired-round-robin");
    expect(MAPS, "fields", List.of("schema", "kind", "maps"));
    expect(MAPS, "mapFields", List.of("map", "blocksSha256", "scenarioSha256"));
    expect(EVALUATION, "version", 2);
    expect(EVALUATION, "mapSelection", "balanced-contiguous-pairs");
    expect(EVALUATION, "matchesPerOpponent", PromotionContract.VALUES.matchesPerOpponent());
    expect(EVALUATION, "firstSeed", 500_000_000);
    expect(EVALUATION, "opponents", List.of("authored", "basic"));
    expect(EVALUATION, "sides", List.of("red", "blue"));
    expect(
        EVALUATION.path("minimumWins"), "authored", PromotionContract.VALUES.minimumAuthoredWins());
    expect(EVALUATION.path("minimumWins"), "basic", PromotionContract.VALUES.minimumBasicWins());
  }

  private PromotionMaps() {}

  static List<Binding> catalog(JsonNode plan) {
    fields(plan, MAPS.path("fields"));
    expect(plan, "schema", MAPS.path("schema"));
    expect(plan, "kind", MAPS.path("kind"));
    var maps = plan.path("maps");
    require(maps.isArray() && !maps.isEmpty(), "nonempty admitted map catalog");
    var result = new ArrayList<Binding>();
    var previous = "";
    for (var map : maps) {
      fields(map, MAPS.path("mapFields"));
      var identity = map.path("map");
      require(
          identity.isString() && identity.asString().matches("[a-z0-9]+(?:-[a-z0-9]+)*"),
          "admitted map identity");
      var id = identity.asString();
      require(previous.compareTo(id) < 0, "unique sorted admitted maps");
      for (var hash : List.of("blocksSha256", "scenarioSha256")) {
        require(map.path(hash).isString(), "admitted map hash");
        PromotionFiles.digest(map.path(hash).asString());
      }
      result.add(
          new Binding(
              id, map.path("blocksSha256").asString(), map.path("scenarioSha256").asString()));
      previous = id;
    }
    return List.copyOf(result);
  }

  static void training(JsonNode training, List<Binding> maps) {
    expect(training, "maps", maps);
    expect(training, "map_coverage_complete", true);
  }

  static List<Matchup> schedule(List<Binding> maps) {
    int pairs = EVALUATION.path("matchesPerOpponent").asInt() / 2;
    require(!maps.isEmpty() && maps.size() <= pairs, "strength coverage of every admitted map");
    var result = new ArrayList<Matchup>();
    for (int map = 0; map < maps.size(); map++)
      for (var opponent : EVALUATION.path("opponents"))
        for (int index = 0; index < pairs; index++)
          if (index * maps.size() / pairs == map)
            result.addAll(
                pair(
                    maps.get(map),
                    opponent.asString(),
                    EVALUATION.path("firstSeed").asInt() + index));
    return List.copyOf(result);
  }

  private static List<Matchup> pair(Binding map, String opponent, int seed) {
    var result = new ArrayList<Matchup>();
    for (var side : EVALUATION.path("sides"))
      result.add(new Matchup(map, opponent, seed, side.asString()));
    return List.copyOf(result);
  }

  static void reportFields(JsonNode value, boolean game) {
    fields(value, EVALUATION.path(game ? "gameFields" : "reportFields"));
  }

  private static void fields(JsonNode value, JsonNode expected) {
    require(expected.isArray() && !expected.isEmpty(), "neutral field inventory");
    var names = new ArrayList<String>();
    for (var name : expected) names.add(name.asString());
    require(
        value.isObject() && Set.copyOf(value.propertyNames()).equals(Set.copyOf(names)),
        "neutral report or map fields");
  }

  private static JsonNode resource(String name) {
    var stream = PromotionMaps.class.getResourceAsStream(name);
    if (stream == null) throw new IllegalStateException("missing neutral map contract " + name);
    try (stream) {
      return PromotionContract.JSON.readTree(stream.readAllBytes());
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }
}
