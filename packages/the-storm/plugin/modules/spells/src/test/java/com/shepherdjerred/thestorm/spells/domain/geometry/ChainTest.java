package com.shepherdjerred.thestorm.spells.domain.geometry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import java.util.function.BiPredicate;
import org.junit.jupiter.api.Test;

final class ChainTest {

  /** Every creature can see every other. */
  static boolean open(String from, String to) {
    return true;
  }

  private static Chain.Link<String> at(String name, double x) {
    return new Chain.Link<>(name, new Vec3(x, 64, 0));
  }

  @Test
  void jumpsToTheNearestUnstruckCreatureEachTime() {
    var path =
        Chain.path(
            at("a", 0),
            List.of(at("far", 5), at("b", 2), at("c", 4), at("d", 9)),
            new Chain.Reach(3, 5),
            ChainTest::open);

    assertThat(path).containsExactly("a", "b", "c", "far");
  }

  @Test
  void stopsAtTheTargetLimit() {
    assertThat(
            Chain.path(
                at("a", 0),
                List.of(at("b", 1), at("c", 2), at("d", 3)),
                new Chain.Reach(3, 2),
                ChainTest::open))
        .containsExactly("a", "b");
  }

  @Test
  void neverStrikesTheSameCreatureTwice() {
    var path =
        Chain.path(
            at("a", 0), List.of(at("a", 0), at("b", 1)), new Chain.Reach(3, 5), ChainTest::open);

    assertThat(path).containsExactly("a", "b");
  }

  @Test
  void aLoneTargetIsStruckOnce() {
    assertThat(Chain.path(at("a", 0), List.of(at("b", 10)), new Chain.Reach(3, 5), ChainTest::open))
        .containsExactly("a");
  }

  @Test
  void tiesGoToTheEarlierCandidate() {
    assertThat(
            Chain.path(
                at("a", 0),
                List.of(at("left", -2), at("right", 2)),
                new Chain.Reach(3, 2),
                ChainTest::open))
        .containsExactly("a", "left");
  }

  @Test
  void theChainNeverJumpsThroughAWall() {
    // A wall stands between b and c: from b the chain cannot see c and stops, even though c is
    // near.
    BiPredicate<String, String> sight = (from, to) -> !(from.equals("b") && to.equals("c"));

    assertThat(
            Chain.path(at("a", 0), List.of(at("b", 2), at("c", 4)), new Chain.Reach(3, 5), sight))
        .containsExactly("a", "b");
  }

  @Test
  void aBlockedNearestJumpFallsBackToAVisibleOne() {
    BiPredicate<String, String> sight = (from, to) -> !to.equals("near");

    assertThat(
            Chain.path(
                at("a", 0), List.of(at("near", 1), at("farther", 2)), new Chain.Reach(3, 5), sight))
        .containsExactly("a", "farther");
  }

  @Test
  void damageFallsOffWithEachJump() {
    assertThat(Chain.damageAt(8, 0.5, 0)).isCloseTo(8, within(1.0e-9));
    assertThat(Chain.damageAt(8, 0.5, 2)).isCloseTo(2, within(1.0e-9));
  }

  @Test
  void aChainStrikesAtLeastOnce() {
    assertThatThrownBy(() -> new Chain.Reach(3, 0)).isInstanceOf(IllegalArgumentException.class);
  }
}
