package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionBundle.expect;
import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionGates.require;

import java.io.IOException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

final class PromotionStrength {
  private PromotionStrength() {}

  static void validate(PromotionFiles files, PromotionProof proof) throws IOException {
    var matches = new HashSet<String>();
    for (var seed : proof.pilot().seeds()) {
      var report = files.json(seed.strength_sha256());
      expect(report, "version", 1);
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
          games.isArray() && games.size() == seed.matches_per_opponent() * 2,
          "complete strength schedule");
      int authored = 0;
      int basic = 0;
      for (int index = 0; index < games.size(); index++) {
        var game = games.get(index);
        game(game, index, matches);
        if (game.path("result").asString().equals("win")) {
          if (index < 200) authored++;
          else basic++;
        }
      }
      require(
          authored == seed.authored_wins() && basic == seed.basic_wins(),
          "recomputed strength wins");
    }
  }

  private static void game(JsonNode game, int index, Set<String> matches) {
    expect(game, "opponent", index < 200 ? "authored" : "basic");
    expect(game, "seed", 500_000_000 + index % 200 / 2);
    expect(game, "side", index % 2 == 0 ? "red" : "blue");
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
            && game.path("submitted_controls").asLong() <= game.path("frames").asLong(),
        "strength action accounting");
  }

  private static void count(JsonNode game, String name) {
    var value = game.path(name);
    require(
        value.isIntegralNumber() && value.canConvertToLong() && value.asLong() >= 0,
        "strength count " + name);
  }
}
