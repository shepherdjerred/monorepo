package com.shepherdjerred.thestorm.rwfbots.domain.learning;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.util.Arrays;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class CategoricalActionsTest {
  @Test
  void independentHeadsPreserveWireOrderWithoutOverflowAtExtremeLogits() {
    var logits = new float[17];
    Arrays.fill(logits, -Float.MAX_VALUE);
    for (var index : new int[] {7, 10, 11, 14, 15}) logits[index] = Float.MAX_VALUE;
    var action = CategoricalActions.sample(logits, new SplittableRandom(17));
    assertThat(action).isEqualTo(new CombatAction(7, true, false, true, false));
  }

  @Test
  void invalidHeadCountsAndNonfiniteValuesAreRejected() {
    var random = new SplittableRandom(17);
    assertThatIllegalArgumentException()
        .isThrownBy(() -> CategoricalActions.sample(new float[16], random));
    var logits = new float[17];
    logits[4] = Float.NaN;
    assertThatIllegalArgumentException()
        .isThrownBy(() -> CategoricalActions.sample(logits, random));
    logits[4] = Float.POSITIVE_INFINITY;
    assertThatIllegalArgumentException()
        .isThrownBy(() -> CategoricalActions.sample(logits, random));
  }
}
