package com.shepherdjerred.thestorm.core.safety;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Random;
import org.junit.jupiter.api.Test;

final class ContentSubmissionIdTest {
  @Test
  void zeroEntropyStillHasRequiredVersionAndVariantBits() {
    assertThat(ContentSubmission.newId(() -> 0L).toString())
        .isEqualTo("00000000-0000-4000-8000-000000000000");
  }

  @Test
  void fullEntropyPreservesEveryBitOutsideVersionAndVariant() {
    assertThat(ContentSubmission.newId(() -> -1L).toString())
        .isEqualTo("ffffffff-ffff-4fff-bfff-ffffffffffff");
  }

  @Test
  void generatedIdsAreDeterministicRfcVersionFourForEverySubmission() {
    var random = new Random(42);
    var replay = new Random(42);
    for (int sample = 0; sample < 1000; sample++) {
      var id = ContentSubmission.newId(random);
      assertThat(id.version()).isEqualTo(4);
      assertThat(id.variant()).isEqualTo(2);
      assertThat(id).isEqualTo(ContentSubmission.newId(replay));
    }
  }
}
