package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionBundle.expect;
import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionGates.require;

import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

final class PromotionStrength {
  private PromotionStrength() {}

  static void validate(PromotionFiles files, PromotionProof proof) throws IOException {
    var matches = new HashSet<String>();
    var maps = PromotionMaps.catalog(files.json(proof.pilot().inputs_sha256()).path("maps"));
    var schedule = PromotionMaps.schedule(maps);
    for (var seed : proof.pilot().seeds()) {
      var report = files.json(seed.strength_sha256());
      PromotionMaps.reportFields(report, false);
      expect(report, "version", 2);
      expect(report, "maps", maps);
      expect(report, "engine", "Paper");
      expect(report, "mode", "pilot");
      expect(report, "acceptance", "unaccepted");
      expect(report, "actor_seed", seed.seed());
      expect(report, "weights_sha256", seed.weights_sha256());
      expect(report, "manifest_sha256", seed.checkpoint_manifest_sha256());
      expect(report, "optimized", false);
      expect(report, "retried_duels", 0);
      expect(report, "blind_preference_checked", false);
      expect(report, "pilot_acceptance_checked", false);
      var games = report.path("games");
      require(
          games.isArray()
              && games.size() == schedule.size()
              && games.size() == seed.matches_per_opponent() * 2,
          "complete strength schedule");
      int authored = 0;
      int basic = 0;
      for (int index = 0; index < games.size(); index++) {
        var game = games.get(index);
        var expected = schedule.get(index);
        game(game, expected, matches);
        if (game.path("result").asString().equals("win")) {
          if (expected.opponent().equals("authored")) authored++;
          else basic++;
        }
      }
      require(
          authored == seed.authored_wins() && basic == seed.basic_wins(),
          "recomputed strength wins");
      validateControlCoverage(games);
    }
  }

  private static void validateControlCoverage(JsonNode games) {
    var controls = new HashMap<String, ControlCoverage>();
    for (var game : games) {
      controls
          .computeIfAbsent(
              game.path("opponent").asString() + ":" + game.path("side").asString(),
              ignored -> new ControlCoverage())
          .add(game);
    }
    for (var opponent : List.of("authored", "basic"))
      for (var side : List.of("red", "blue"))
        require(
            controls
                .get(opponent + ":" + side)
                .meets(PromotionMaps.minimumControlCoveragePercent()),
            "minimum learned control coverage");
  }

  private static void game(JsonNode game, PromotionMaps.Matchup expected, Set<String> matches) {
    PromotionMaps.reportFields(game, true);
    expect(game, "engine", "Paper");
    expect(game, "map", expected.binding().map());
    expect(game, "blocksSha256", expected.binding().blocksSha256());
    expect(game, "scenarioSha256", expected.binding().scenarioSha256());
    expect(game, "opponent", expected.opponent());
    expect(game, "seed", expected.seed());
    expect(game, "side", expected.side());
    var match = game.path("match").asString();
    require(
        UUID.fromString(match).toString().equals(match) && matches.add(match),
        "distinct native strength matches");
    require(
        Set.of("win", "loss", "draw", "timeout").contains(game.path("result").asString()),
        "native duel outcome");
    for (var name :
        List.of(
            "frames",
            "submitted_controls",
            "confirmed_controls",
            "applied_controls",
            "authored_fallbacks",
            "missed_ticks",
            "rejected_actions",
            "memory_resets")) count(game, name);
    for (var name : List.of("dealt", "received", "seconds", "max_inference_ms")) {
      var number = game.path(name);
      require(
          number.isNumber() && Double.isFinite(number.asDouble()) && number.asDouble() >= 0,
          "strength metric " + name);
    }
    require(
        game.path("frames").asLong() > 0
            && game.path("confirmed_controls").asLong() <= game.path("submitted_controls").asLong()
            && game.path("submitted_controls").asLong() <= game.path("frames").asLong()
            && game.path("applied_controls").asLong() <= game.path("frames").asLong(),
        "strength action accounting");
  }

  private static final class ControlCoverage {
    private long frames;
    private long submitted;
    private long confirmed;
    private long applied;

    void add(JsonNode game) {
      frames = Math.addExact(frames, game.path("frames").asLong());
      submitted = Math.addExact(submitted, game.path("submitted_controls").asLong());
      confirmed = Math.addExact(confirmed, game.path("confirmed_controls").asLong());
      applied = Math.addExact(applied, game.path("applied_controls").asLong());
    }

    boolean meets(int percent) {
      require(frames > 0, "nonempty learned control coverage");
      return submitted / (double) frames >= percent / 100.0
          && confirmed / (double) frames >= percent / 100.0
          && applied / (double) frames >= percent / 100.0;
    }
  }

  private static void count(JsonNode game, String name) {
    var value = game.path(name);
    require(
        value.isIntegralNumber() && value.canConvertToLong() && value.asLong() >= 0,
        "strength count " + name);
  }
}
