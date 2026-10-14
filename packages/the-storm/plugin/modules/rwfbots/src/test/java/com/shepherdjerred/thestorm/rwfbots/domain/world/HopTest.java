package com.shepherdjerred.thestorm.rwfbots.domain.world;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

final class HopTest {
  @Test
  void decodesEveryByteWithTheExistingStableCodeAndFailureContract() {
    var declared = Hop.values();
    for (var value = (int) Byte.MIN_VALUE; value <= Byte.MAX_VALUE; value++) {
      var code = (byte) value;
      var expected = Arrays.stream(declared).filter(hop -> hop.code() == code).findFirst();
      if (expected.isPresent()) {
        assertThat(Hop.ofCode(code)).isSameAs(expected.orElseThrow());
      } else {
        assertThatThrownBy(() -> Hop.ofCode(code))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("unknown hop code: %s", code);
      }
    }
  }
}
