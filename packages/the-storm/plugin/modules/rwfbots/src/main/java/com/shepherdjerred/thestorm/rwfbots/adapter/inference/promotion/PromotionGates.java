package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import java.util.HashSet;
import java.util.List;

/** Fixed gates are derived from measured numbers, never an operator-supplied pass label. */
public final class PromotionGates {
  private static final PromotionContract.Values CONTRACT = PromotionContract.VALUES;

  private PromotionGates() {}

  public static void validate(PromotionProof proof) {
    require(
        proof.schema() == CONTRACT.version() && proof.kind().equals(CONTRACT.kind()), "version");
    require(proof.promotion_contract_sha256().equals(PromotionContract.SHA256), "contract digest");
    pilot(proof);
    preference(proof);
    parity(proof.parity());
    load(proof.load());
    regressions(proof);
  }

  private static void pilot(PromotionProof proof) {
    var seeds = proof.pilot().seeds();
    require(seeds.size() == CONTRACT.seeds(), "three pilot seeds");
    var identities = new HashSet<Integer>();
    long previous = 0;
    for (var seed : seeds) {
      require(
          seed.seed() >= 0 && seed.seed() <= 1_000_000_000 && identities.add(seed.seed()),
          "seed identity");
      require(
          seed.started_ms() >= previous
              && seed.deadline_ms() >= seed.started_ms()
              && seed.deadline_ms() - seed.started_ms() == CONTRACT.seedSeconds() * 1000L
              && seed.completed_ms() >= seed.started_ms()
              && seed.completed_ms() <= seed.deadline_ms(),
          "original pilot budget");
      previous = seed.completed_ms();
      require(seed.matches_per_opponent() == CONTRACT.matchesPerOpponent(), "strength denominator");
      require(
          seed.authored_wins() >= CONTRACT.minimumAuthoredWins()
              && seed.authored_wins() <= CONTRACT.matchesPerOpponent(),
          "authored strength");
      require(
          seed.basic_wins() >= CONTRACT.minimumBasicWins()
              && seed.basic_wins() <= CONTRACT.matchesPerOpponent(),
          "basic strength");
    }
    var candidate = seeds.getFirst();
    require(
        candidate.checkpoint_manifest_sha256().equals(proof.checkpoint_manifest_sha256())
            && candidate.weights_sha256().equals(proof.weights_sha256()),
        "first sealed candidate");
  }

  private static void preference(PromotionProof proof) {
    var preference = proof.preference();
    require(
        preference.candidate_seed() == proof.pilot().seeds().getFirst().seed(), "review candidate");
    require(preference.source().equals("manual-human-review"), "human review source");
    require(
        preference.pairs() == CONTRACT.preferencePairs()
            && preference.learned_votes() >= CONTRACT.minimumLearnedVotes()
            && preference.authored_votes() >= 0
            && preference.ties() >= 0
            && (long) preference.learned_votes() + preference.authored_votes() + preference.ties()
                == preference.pairs(),
        "blind preference");
  }

  private static void parity(PromotionProof.Parity parity) {
    require(
        parity.batches().equals(CONTRACT.parityBatches())
            && parity.steps() == CONTRACT.paritySteps()
            && parity.rtol() == CONTRACT.rtol()
            && parity.atol() == CONTRACT.atol(),
        "recurrent parity coverage");
  }

  private static void load(PromotionProof.Load load) {
    require(
        load.cpus() == CONTRACT.cpus()
            && load.heap().equals(CONTRACT.heap())
            && load.memory_limit_bytes() == CONTRACT.memoryLimitBytes(),
        "native load resources");
    require(load.baseline_ticks() >= CONTRACT.baselineTicks(), "load baseline coverage");
    duration(load.baseline_p95());
    require(
        load.phases().stream()
            .map(PromotionProof.Population::bots)
            .toList()
            .equals(CONTRACT.loadPopulations()),
        "load populations");
    for (var phase : load.phases()) population(phase);
  }

  private static void population(PromotionProof.Population phase) {
    require(
        phase.ticks() >= phase.live_ticks()
            && phase.live_ticks() >= CONTRACT.liveTicks()
            && phase.full_roster_ticks() >= CONTRACT.fullRosterTicks()
            && phase.full_roster_ticks() <= phase.live_ticks()
            && phase.maximum_batch() == phase.bots(),
        "native load coverage");
    duration(phase.p95());
    duration(phase.live_p95());
    duration(phase.full_roster_p95());
    require(
        List.of(
                phase.submitted(),
                phase.skipped(),
                phase.rejected(),
                phase.deadline_met(),
                phase.deadline_missed())
            .stream()
            .allMatch(value -> value >= 0),
        "nonnegative deadline counters");
    long completed = Math.addExact(phase.deadline_met(), phase.deadline_missed());
    long attempts =
        Math.addExact(Math.addExact(phase.submitted(), phase.skipped()), phase.rejected());
    require(
        completed <= phase.submitted()
            && attempts > 0
            && (double) phase.deadline_met() / attempts >= CONTRACT.deadlineFraction(),
        "two-tick deadlines");
    require(
        phase.applied() > 0
            && Double.isFinite(phase.damage())
            && phase.damage() > 0
            && phase.damage_events() > 0,
        "native learned actions and damage");
  }

  private static void duration(double value) {
    require(
        Double.isFinite(value) && value >= 0 && value < CONTRACT.serverP95Milliseconds(),
        "server p95");
  }

  private static void regressions(PromotionProof proof) {
    var regression = proof.regressions();
    require(
        regression.actor_sha256().equals(proof.actor_sha256())
            && regression.native_sha256().equals(proof.native_sha256()),
        "regression candidate and runtime");
    require(
        regression.cases().stream()
            .map(PromotionProof.Case::name)
            .toList()
            .equals(CONTRACT.regressionCases()),
        "regression inventory");
    for (var test : regression.cases())
      require(
          test.checks() > 0 && test.failures() == 0 && test.skipped() == 0,
          "regression " + test.name());
    nativeFloors(regression.native_floors());
    simulationFloors(regression.simulation_floors());
  }

  private static void nativeFloors(PromotionProof.NativeFloors facts) {
    var floors = CONTRACT.nativeFloors();
    require(facts.bots() == 16, "native team roster");
    minimum(facts.minimum_spacing(), floors.spacing());
    minimum(facts.minimum_width_at_8(), floors.width());
    minimum(facts.minimum_width_at_contact(), floors.width());
    minimum(facts.minimum_forward(), floors.forward());
    maximum(facts.maximum_winding(), floors.winding());
  }

  private static void simulationFloors(PromotionProof.SimulationFloors facts) {
    var floors = CONTRACT.simulationFloors();
    require(
        facts.strategy_pairs() == 16 && facts.contacts() == 16,
        "simulation strategy and contact coverage");
    minimum(facts.minimum_width(), floors.width());
    minimum(facts.median_width(), floors.medianWidth());
    minimum(facts.mean_forward(), floors.forward());
    maximum(facts.maximum_winding(), floors.winding());
  }

  private static void minimum(double value, double floor) {
    require(Double.isFinite(value) && value >= floor, "advancement minimum");
  }

  private static void maximum(double value, double ceiling) {
    require(Double.isFinite(value) && value >= 0 && value <= ceiling, "advancement winding");
  }

  static void require(boolean condition, String gate) {
    if (!condition) throw new IllegalArgumentException("actor promotion failed: " + gate);
  }
}
