package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import java.util.List;

/** Gate facts plus the complete portable evidence catalogue. No pass booleans are accepted. */
public record PromotionProof(
    int schema,
    String kind,
    String promotion_contract_sha256,
    String actor_sha256,
    String source_manifest_sha256,
    String checkpoint_manifest_sha256,
    String weights_sha256,
    String dataset_sha256,
    String native_sha256,
    Pilot pilot,
    Preference preference,
    Parity parity,
    Load load,
    Regressions regressions,
    List<File> files) {
  public record File(String file, String sha256) {}

  public record Pilot(
      String ledger_sha256,
      String inputs_sha256,
      String strength_claim_sha256,
      String strength_plan_sha256,
      List<Seed> seeds) {}

  public record Seed(
      int seed,
      long started_ms,
      long deadline_ms,
      long completed_ms,
      String claim_sha256,
      String result_sha256,
      String checkpoint_manifest_sha256,
      String weights_sha256,
      int matches_per_opponent,
      int authored_wins,
      int basic_wins,
      String strength_sha256) {}

  public record Preference(
      int candidate_seed,
      int pairs,
      int learned_votes,
      int authored_votes,
      int ties,
      String source,
      String claim_sha256,
      String plan_sha256,
      String review_sha256,
      String key_sha256,
      String ballot_sha256,
      String result_sha256) {}

  public record Parity(
      String receipt_sha256,
      String samples_sha256,
      List<Integer> batches,
      int steps,
      double rtol,
      double atol) {}

  public record Load(
      String inputs_sha256,
      String phases_sha256,
      String log_sha256,
      String result_sha256,
      int cpus,
      String heap,
      long memory_limit_bytes,
      int baseline_ticks,
      double baseline_p95,
      List<Population> phases) {}

  public record Population(
      int bots,
      int ticks,
      int live_ticks,
      int full_roster_ticks,
      long submitted,
      long skipped,
      long rejected,
      long deadline_met,
      long deadline_missed,
      int maximum_batch,
      double p95,
      double live_p95,
      double full_roster_p95,
      long applied,
      double damage,
      long damage_events) {}

  public record Regressions(
      String evidence_sha256,
      String actor_sha256,
      String native_sha256,
      List<Case> cases,
      NativeFloors native_floors,
      SimulationFloors simulation_floors) {}

  public record Case(String name, int checks, int failures, int skipped) {}

  public record NativeFloors(
      int bots,
      double minimum_spacing,
      double minimum_width_at_8,
      double minimum_width_at_contact,
      double minimum_forward,
      double maximum_winding) {}

  public record SimulationFloors(
      int strategy_pairs,
      int contacts,
      double minimum_width,
      double median_width,
      double mean_forward,
      double maximum_winding) {}
}
