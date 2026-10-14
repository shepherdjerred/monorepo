package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class DistanceFieldTest {
  @Test
  void rejectsNaNAndNegativeDistances() {
    for (var value :
        new float[] {Float.NaN, Float.intBitsToFloat(0x7f800001), -1, Float.NEGATIVE_INFINITY})
      assertThatThrownBy(() -> new DistanceField(new float[] {0, value}))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("distance");
  }

  @Test
  void preservesSignedZeroSubnormalsAndUnreachableInfinityAndOwnsItsArray() {
    var input = new float[] {0, -0.0f, Float.MIN_VALUE, Float.MAX_VALUE, Float.POSITIVE_INFINITY};
    var field = new DistanceField(input);
    input[0] = -1;
    field.values()[1] = 1;
    assertThat(field.at(0)).isZero();
    assertThat(Float.floatToRawIntBits(field.at(1))).isEqualTo(Integer.MIN_VALUE);
    assertThat(field.at(2)).isEqualTo(Float.MIN_VALUE);
    assertThat(field.at(3)).isEqualTo(Float.MAX_VALUE);
    assertThat(field.at(4)).isEqualTo(Float.POSITIVE_INFINITY);
    assertThat(field.reachable(2)).isTrue();
    assertThat(field.reachable(4)).isFalse();
  }
}
