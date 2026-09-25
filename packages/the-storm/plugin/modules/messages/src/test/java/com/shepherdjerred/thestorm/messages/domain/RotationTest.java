package com.shepherdjerred.thestorm.messages.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.OptionalInt;
import java.util.SplittableRandom;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class RotationTest {

  @Test
  void cycleWalksInOrderAndWraps() {
    var cycle = Cycle.of(3);
    var shown = new ArrayList<Integer>();
    for (var i = 0; i < 7; i++) {
      shown.add(cycle.position());
      cycle = cycle.next();
    }

    assertThat(shown).containsExactly(0, 1, 2, 0, 1, 2, 0);
  }

  @Test
  void cycleOfOneAlwaysShowsTheSameEntry() {
    assertThat(Cycle.of(1).next().next().position()).isZero();
  }

  @Test
  void cycleRejectsBadState() {
    assertThatThrownBy(() -> Cycle.of(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Cycle(3, 3)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Cycle(3, -1)).isInstanceOf(IllegalArgumentException.class);
  }

  @ParameterizedTest
  @ValueSource(ints = {1, 2, 5, 15})
  void shuffleBagShowsEveryEntryOncePerRound(int size) {
    var draws = draw(ShuffleBag.of(size), new SplittableRandom(42), size * 4);

    for (var round = 0; round < 4; round++) {
      assertThat(draws.subList(round * size, (round + 1) * size))
          .containsExactlyInAnyOrderElementsOf(range(size));
    }
  }

  @Test
  void shuffleBagNeverRepeatsAcrossARoundBoundary() {
    var size = 3;
    for (var seed = 0; seed < 200; seed++) {
      var draws = draw(ShuffleBag.of(size), new SplittableRandom(seed), size * 10);
      for (var i = 1; i < draws.size(); i++) {
        assertThat(draws.get(i)).as("seed %d draw %d", seed, i).isNotEqualTo(draws.get(i - 1));
      }
    }
  }

  @Test
  void shuffleBagReplaysUnderAFixedSeed() {
    assertThat(draw(ShuffleBag.of(15), new SplittableRandom(2015), 45))
        .isEqualTo(draw(ShuffleBag.of(15), new SplittableRandom(2015), 45));
  }

  @Test
  void shuffleBagRejectsBadState() {
    assertThatThrownBy(() -> ShuffleBag.of(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new ShuffleBag(2, List.of(2), OptionalInt.empty()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private static List<Integer> draw(ShuffleBag start, RandomGenerator random, int count) {
    var bag = start;
    var draws = new ArrayList<Integer>();
    for (var i = 0; i < count; i++) {
      var draw = bag.draw(random);
      draws.add(draw.index());
      bag = draw.next();
    }
    return draws;
  }

  private static List<Integer> range(int size) {
    var indexes = new ArrayList<Integer>();
    for (var i = 0; i < size; i++) {
      indexes.add(i);
    }
    return indexes;
  }
}
