package com.shepherdjerred.thestorm.spells.domain.geometry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

final class ChainTest {

  private static Chain.Link<String> at(String name, double x) {
    return new Chain.Link<>(name, new Vec3(x, 64, 0));
  }

  @Test
  void jumpsToTheNearestUnstruckCreatureEachTime() {
    var path =
        Chain.path(at("a", 0), List.of(at("far", 5), at("b", 2), at("c", 4), at("d", 9)), 3, 5);

    assertThat(path).containsExactly("a", "b", "c", "far");
  }

  @Test
  void stopsAtTheTargetLimit() {
    assertThat(Chain.path(at("a", 0), List.of(at("b", 1), at("c", 2), at("d", 3)), 3, 2))
        .containsExactly("a", "b");
  }

  @Test
  void neverStrikesTheSameCreatureTwice() {
    var path = Chain.path(at("a", 0), List.of(at("a", 0), at("b", 1)), 3, 5);

    assertThat(path).containsExactly("a", "b");
  }

  @Test
  void aLoneTargetIsStruckOnce() {
    assertThat(Chain.path(at("a", 0), List.of(at("b", 10)), 3, 5)).containsExactly("a");
  }

  @Test
  void tiesGoToTheEarlierCandidate() {
    assertThat(Chain.path(at("a", 0), List.of(at("left", -2), at("right", 2)), 3, 2))
        .containsExactly("a", "left");
  }

  @Test
  void damageFallsOffWithEachJump() {
    assertThat(Chain.damageAt(8, 0.5, 0)).isCloseTo(8, within(1.0e-9));
    assertThat(Chain.damageAt(8, 0.5, 2)).isCloseTo(2, within(1.0e-9));
  }

  @Test
  void aChainStrikesAtLeastOnce() {
    assertThatThrownBy(() -> Chain.path(at("a", 0), List.of(), 3, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
