package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

final class PromotionMapsTest {
  private static ObjectNode fixture() throws Exception {
    var directory =
        Path.of(Objects.requireNonNull(System.getProperty("thestorm.rwfbots.actorParity")));
    return (ObjectNode)
        PromotionContract.JSON.readTree(Files.readAllBytes(directory.resolve("strength.json")));
  }

  private static ObjectNode plan() throws Exception {
    return PromotionFixture.object(
        "schema", 1, "kind", "rwf-training-maps", "maps", fixture().path("maps"));
  }

  @Test
  void javaScheduleMatchesEveryPythonProducedMapSeedOpponentAndSide() throws Exception {
    var input = fixture();
    var maps = PromotionMaps.catalog(plan());
    var schedule = PromotionMaps.schedule(maps);
    assertThat(maps).hasSize(32);
    assertThat(schedule).hasSize(400);
    for (int index = 0; index < schedule.size(); index++) {
      var matchup = schedule.get(index);
      var expected = input.path("games").get(index);
      assertThat(expected)
          .isEqualTo(
              PromotionFixture.object(
                  "map",
                  matchup.binding().map(),
                  "blocksSha256",
                  matchup.binding().blocksSha256(),
                  "scenarioSha256",
                  matchup.binding().scenarioSha256(),
                  "opponent",
                  matchup.opponent(),
                  "seed",
                  matchup.seed(),
                  "side",
                  matchup.side()));
    }
    for (var map : maps) {
      var authored =
          schedule.stream()
              .filter(game -> game.binding().equals(map) && game.opponent().equals("authored"))
              .toList();
      var basic =
          schedule.stream()
              .filter(game -> game.binding().equals(map) && game.opponent().equals("basic"))
              .toList();
      assertThat(authored.size()).isIn(6, 8);
      assertThat(authored.stream().map(PromotionMaps.Matchup::seed).toList())
          .isEqualTo(basic.stream().map(PromotionMaps.Matchup::seed).toList());
      assertThat(authored.stream().map(PromotionMaps.Matchup::side).toList())
          .isEqualTo(basic.stream().map(PromotionMaps.Matchup::side).toList());
    }
  }

  @Test
  void invalidCatalogsAndUncoverableSchedulesFail() throws Exception {
    var original = plan();
    var mutations =
        List.<Consumer<ObjectNode>>of(
            value -> value.put("schema", "1"),
            value -> value.put("extra", true),
            value -> value.set("maps", PromotionContract.JSON.createArrayNode()),
            value -> ((ArrayNode) value.path("maps")).add(value.path("maps").get(0)),
            value -> ((ObjectNode) value.path("maps").get(0)).put("scenarioSha256", "bad"),
            value -> ((ObjectNode) value.path("maps").get(0)).put("map", 42),
            value -> ((ObjectNode) value.path("maps").get(0)).put("extra", true));
    for (var mutation : mutations) {
      var changed = original.deepCopy();
      mutation.accept(changed);
      assertThatIllegalArgumentException().isThrownBy(() -> PromotionMaps.catalog(changed));
    }
    var maps = new ArrayList<>(PromotionMaps.catalog(original));
    while (maps.size() <= 100) maps.add(maps.getFirst());
    assertThatIllegalArgumentException().isThrownBy(() -> PromotionMaps.schedule(maps));
    assertThatIllegalArgumentException().isThrownBy(() -> PromotionMaps.schedule(List.of()));
  }

  @Test
  void trainingMustCoverTheOriginalCatalogWithIdenticalTerrainAndScenarios() throws Exception {
    var maps = PromotionMaps.catalog(plan());
    var training = PromotionFixture.object("maps", maps, "map_coverage_complete", true);
    PromotionMaps.training(training, maps);
    var mutations =
        List.<Consumer<ObjectNode>>of(
            value -> value.put("map_coverage_complete", false),
            value -> ((ArrayNode) value.path("maps")).remove(0),
            value -> ((ObjectNode) value.path("maps").get(0)).put("blocksSha256", "f".repeat(64)),
            value ->
                ((ObjectNode) value.path("maps").get(0)).put("scenarioSha256", "f".repeat(64)));
    for (var mutation : mutations) {
      var changed = training.deepCopy();
      mutation.accept(changed);
      assertThatIllegalArgumentException().isThrownBy(() -> PromotionMaps.training(changed, maps));
    }
  }
}
