package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.EnumMap;
import java.util.Map;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class SoftmaxTest {

  private static final Map<Option, Double> SCORES =
      Map.of(Option.ARM, 0.7, Option.HUNT, 0.65, Option.HOLD_ANGLE, 0.1, Option.ENGAGE, 0.69);

  @Test
  void zeroTemperatureIsArgmax() {
    var random = new SplittableRandom(1);
    for (var i = 0; i < 500; i++) {
      assertThat(Softmax.select(SCORES, 1e-6, random).choice()).isEqualTo(Option.ARM);
    }
    var probabilities = Softmax.probabilities(new EnumMap<>(SCORES), 1e-6);
    assertThat(probabilities.get(Option.ARM)).isEqualTo(1.0);
    assertThat(probabilities.get(Option.HUNT)).isZero();
  }

  @Test
  void probabilitiesSumToOneAndOrderByScore() {
    var probabilities = Softmax.probabilities(new EnumMap<>(SCORES), 0.3);
    var total = probabilities.values().stream().mapToDouble(Double::doubleValue).sum();
    assertThat(total).isCloseTo(1, within(1e-9));
    assertThat(probabilities.get(Option.ARM)).isGreaterThan(probabilities.get(Option.ENGAGE));
    assertThat(probabilities.get(Option.ENGAGE)).isGreaterThan(probabilities.get(Option.HUNT));
    assertThat(probabilities.get(Option.HUNT)).isGreaterThan(probabilities.get(Option.HOLD_ANGLE));
  }

  @Test
  void highTemperatureSpreadsChoicesAndMatchesProbabilities() {
    var random = new SplittableRandom(2);
    var counts = new EnumMap<Option, Integer>(Option.class);
    var n = 20_000;
    for (var i = 0; i < n; i++) {
      counts.merge(Softmax.select(SCORES, 0.3, random).choice(), 1, Integer::sum);
    }
    var probabilities = Softmax.probabilities(new EnumMap<>(SCORES), 0.3);
    for (var option : SCORES.keySet()) {
      var observed = counts.getOrDefault(option, 0) / (double) n;
      assertThat(observed).as(option.name()).isCloseTo(probabilities.get(option), within(0.02));
    }
  }
}
