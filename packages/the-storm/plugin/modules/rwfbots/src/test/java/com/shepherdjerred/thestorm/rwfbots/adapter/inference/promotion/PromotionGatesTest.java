package com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion;

import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.node.ObjectNode;

final class PromotionGatesTest {
  @Test
  void fixedQualityAndResourceGatesRejectIncompleteOrInsufficientFacts(@TempDir Path directory)
      throws Exception {
    var fixture = new PromotionFixture(directory);
    reject(fixture, "pilot/seeds/0/authored_wins", 119);
    reject(fixture, "pilot/seeds/1/basic_wins", 159);
    reject(fixture, "pilot/seeds/2/matches_per_opponent", 199);
    reject(fixture, "pilot/seeds/1/seed", 17000);
    reject(fixture, "pilot/seeds/0/deadline_ms", 1_700_028_800_001L);
    reject(fixture, "pilot/seeds/1/started_ms", 1_700_000_000_000L);
    reject(fixture, "preference/learned_votes", 14);
    reject(fixture, "preference/ties", 6);
    reject(fixture, "preference/candidate_seed", 17001);
    reject(fixture, "preference/source", "automated-review");
    reject(fixture, "parity/steps", 15);
    reject(fixture, "parity/atol", 1e-4);
    reject(fixture, "load/cpus", 5);
    reject(fixture, "load/heap", "9G");
    reject(fixture, "load/memory_limit_bytes", 10737418241L);
    reject(fixture, "load/baseline_ticks", 1799);
    reject(fixture, "load/baseline_p95", 50);
    reject(fixture, "load/phases/1/bots", 20);
    reject(fixture, "load/phases/2/live_ticks", 2999);
    reject(fixture, "load/phases/0/full_roster_ticks", 199);
    reject(fixture, "load/phases/0/maximum_batch", 19);
    reject(fixture, "load/phases/0/deadline_met", 9899);
    reject(fixture, "load/phases/0/skipped", 1000);
    reject(fixture, "load/phases/0/rejected", 1000);
    reject(fixture, "load/phases/0/deadline_missed", 101);
    reject(fixture, "load/phases/0/full_roster_p95", 50);
    reject(fixture, "load/phases/0/applied", 0);
    reject(fixture, "load/phases/0/damage", 0);
    reject(fixture, "regressions/cases/0/skipped", 1);
    reject(fixture, "regressions/cases/1/failures", 1);
    reject(fixture, "regressions/native_floors/minimum_spacing", 2.49);
    reject(fixture, "regressions/native_floors/minimum_width_at_contact", 15.99);
    reject(fixture, "regressions/native_floors/minimum_forward", 0.249);
    reject(fixture, "regressions/native_floors/maximum_winding", 2.51);
    reject(fixture, "regressions/simulation_floors/contacts", 15);
    reject(fixture, "regressions/simulation_floors/median_width", 23.99);
    reject(fixture, "regressions/simulation_floors/mean_forward", 0.449);
    reject(fixture, "regressions/actor_sha256", "a".repeat(64));
  }

  private static void reject(PromotionFixture fixture, String field, Object value) {
    var changed = fixture.proof.deepCopy();
    var pointer = "/" + field;
    var parent = (ObjectNode) changed.at(pointer.substring(0, pointer.lastIndexOf('/')));
    parent.set(
        field.substring(field.lastIndexOf('/') + 1), PromotionContract.JSON.valueToTree(value));
    var proof =
        PromotionContract.JSON.readValue(
            PromotionContract.JSON.writeValueAsString(changed), PromotionProof.class);
    assertThatIllegalArgumentException().as(field).isThrownBy(() -> PromotionGates.validate(proof));
  }
}
