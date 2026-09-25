package com.shepherdjerred.thestorm.shards.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import org.junit.jupiter.api.Test;

final class PlacedPositionsTest {

  @Test
  void everyPositionInAChunkPacksUniquely() {
    var seen = new HashSet<Integer>();
    for (var y = -64; y < 320; y++) {
      for (var x = 0; x < 16; x++) {
        for (var z = 0; z < 16; z++) {
          assertThat(seen.add(PlacedPositions.pack(x, y, z))).isTrue();
        }
      }
    }
  }

  @Test
  void packingUsesChunkLocalCoordinates() {
    // Block (-71, 74, -243) sits at chunk-local (9, 13), the same as (9, 74, 13).
    assertThat(PlacedPositions.pack(-71, 74, -243)).isEqualTo(PlacedPositions.pack(9, 74, 13));
  }

  @Test
  void addsAndRemovesWithoutTouchingTheInput() {
    var ore = PlacedPositions.pack(1, -20, 2);
    var other = PlacedPositions.pack(3, 40, 4);
    var empty = PlacedPositions.none();

    var one = PlacedPositions.with(empty, ore);
    var two = PlacedPositions.with(one, other);
    var back = PlacedPositions.without(two, ore);

    assertThat(empty).isEmpty();
    assertThat(one).containsExactly(ore);
    assertThat(two).containsExactly(ore, other);
    assertThat(back).containsExactly(other);
    assertThat(PlacedPositions.contains(two, ore)).isTrue();
    assertThat(PlacedPositions.contains(back, ore)).isFalse();
  }

  @Test
  void addingTwiceKeepsOneEntry() {
    var ore = PlacedPositions.pack(0, 0, 0);

    var twice = PlacedPositions.with(PlacedPositions.with(PlacedPositions.none(), ore), ore);

    assertThat(twice).containsExactly(ore);
  }

  @Test
  void removingAnAbsentPositionChangesNothing() {
    var ore = PlacedPositions.pack(5, 5, 5);
    var stored = PlacedPositions.with(PlacedPositions.none(), ore);

    assertThat(PlacedPositions.without(stored, PlacedPositions.pack(6, 5, 5))).containsExactly(ore);
  }
}
