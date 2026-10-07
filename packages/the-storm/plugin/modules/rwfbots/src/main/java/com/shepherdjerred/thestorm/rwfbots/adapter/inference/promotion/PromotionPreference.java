package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionBundle.expect;
import static com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionGates.require;

import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import tools.jackson.databind.JsonNode;

final class PromotionPreference {
  private PromotionPreference() {}

  static void validate(PromotionFiles files, PromotionProof proof) throws IOException {
    var facts = proof.preference();
    var review = files.json(facts.review_sha256());
    var key = files.json(facts.key_sha256());
    var ballot = files.json(facts.ballot_sha256());
    var result = files.json(facts.result_sha256());
    plan(files, proof, result);
    for (var document : java.util.List.of(review, key, ballot, result))
      expect(document, "version", 1);
    expect(key, "actor_sha256", proof.actor_sha256());
    expect(key, "review_sha256", facts.review_sha256());
    expect(ballot, "review_sha256", facts.review_sha256());
    expect(ballot, "source", facts.source());
    expect(result, "actor_sha256", proof.actor_sha256());
    expect(result, "review_sha256", facts.review_sha256());
    expect(result, "key_sha256", facts.key_sha256());
    expect(result, "ballot_sha256", facts.ballot_sha256());
    array(review, "pairs");
    array(key, "pairs");
    array(ballot, "answers");
    array(result, "rows");
    var clips = new HashSet<String>();
    int learned = 0;
    int authored = 0;
    int ties = 0;
    for (int index = 0; index < facts.pairs(); index++) {
      var pair = review.path("pairs").get(index);
      var label = key.path("pairs").get(index);
      var answer = ballot.path("answers").get(index);
      var row = result.path("rows").get(index);
      for (var item : java.util.List.of(pair, label, answer, row)) expect(item, "pair", index + 1);
      expect(pair, "subject", index % 2 == 0 ? "red fighter" : "blue fighter");
      clips(files, pair, index + 1, clips);
      var chosen = answer.path("choice").asString();
      var humanlike = label.path("learned").asString();
      require(
          Set.of("A", "B").contains(humanlike) && Set.of("A", "B", "tie").contains(chosen),
          "blind vote label");
      var preferred = preferred(chosen, humanlike);
      expect(row, "preferred", preferred);
      expect(row, "reason", answer.path("reason"));
      switch (preferred) {
        case "learned" -> learned++;
        case "authored" -> authored++;
        case "tie" -> ties++;
        default -> throw new IllegalStateException("unknown blind vote");
      }
    }
    require(
        learned == facts.learned_votes()
            && authored == facts.authored_votes()
            && ties == facts.ties(),
        "recomputed blind votes");
    expect(result, "pairs", facts.pairs());
    expect(result, "learnedVotes", learned);
    expect(result, "authoredVotes", authored);
    expect(result, "ties", ties);
  }

  private static void plan(PromotionFiles files, PromotionProof proof, JsonNode result)
      throws IOException {
    var facts = proof.preference();
    var claim = files.json(facts.claim_sha256());
    expect(claim, "plan_sha256", facts.plan_sha256());
    expect(result, "plan_sha256", facts.plan_sha256());
    var plan = files.json(facts.plan_sha256());
    expect(plan, "version", 1);
    expect(plan, "actor_sha256", proof.actor_sha256());
    var frozen = plan.path("files");
    require(frozen.isArray() && !frozen.isEmpty(), "original review inputs");
    for (var file : frozen) files.path(file.path("sha256").asString());
  }

  private static void array(JsonNode node, String name) {
    require(
        node.path(name).isArray()
            && node.path(name).size() == PromotionContract.VALUES.preferencePairs(),
        "blind vote denominator");
  }

  private static String preferred(String chosen, String humanlike) {
    if (chosen.equals("tie")) return "tie";
    return chosen.equals(humanlike) ? "learned" : "authored";
  }

  private static void clips(PromotionFiles files, JsonNode pair, int number, Set<String> clips) {
    for (var label : java.util.List.of("A", "B")) {
      var clip = pair.path(label);
      expect(
          clip,
          "file",
          "pair-" + String.format(java.util.Locale.ROOT, "%02d", number) + "-" + label + ".mp4");
      var digest = clip.path("sha256").asString();
      require(clips.add(digest), "unique blind clips");
      files.path(digest);
    }
  }
}
