package com.shepherdjerred.thestorm.essentials.domain.place;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.essentials.domain.place.SafeSpots.BlockPos;
import com.shepherdjerred.thestorm.essentials.domain.place.SafeSpots.Ground;
import com.shepherdjerred.thestorm.essentials.domain.place.SafeSpots.HeightRange;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class SafeSpotsTest {

  static final HeightRange RANGE = new HeightRange(-64, 320);

  /** A single column at x = z = 0; unset blocks are open air. */
  static final class Column implements SafeSpots.BlockView {
    final Map<Integer, Ground> blocks = new HashMap<>();

    Column set(int y, Ground ground) {
      blocks.put(y, ground);
      return this;
    }

    Column fill(int from, int to, Ground ground) {
      for (var y = from; y <= to; y++) {
        blocks.put(y, ground);
      }
      return this;
    }

    @Override
    public Ground at(int x, int y, int z) {
      return blocks.getOrDefault(y, Ground.OPEN);
    }
  }

  static BlockPos at(int y) {
    return new BlockPos(0, y, 0);
  }

  @Test
  void standingOnAFloorWithTwoOpenBlocksIsSafe() {
    var column = new Column().set(63, Ground.FLOOR);

    assertThat(SafeSpots.isSafe(column, RANGE, at(64))).isTrue();
  }

  @Test
  void noFloorIsUnsafe() {
    assertThat(SafeSpots.isSafe(new Column(), RANGE, at(64))).isFalse();
  }

  @Test
  void aBlockedBodyOrHeadIsUnsafe() {
    assertThat(SafeSpots.isSafe(new Column().fill(63, 64, Ground.FLOOR), RANGE, at(64))).isFalse();
    assertThat(
            SafeSpots.isSafe(
                new Column().set(63, Ground.FLOOR).set(65, Ground.FLOOR), RANGE, at(64)))
        .isFalse();
  }

  @Test
  void hazardsAreNeitherFloorNorSpace() {
    assertThat(SafeSpots.isSafe(new Column().set(63, Ground.HAZARD), RANGE, at(64))).isFalse();
    assertThat(
            SafeSpots.isSafe(
                new Column().set(63, Ground.FLOOR).set(64, Ground.HAZARD), RANGE, at(64)))
        .isFalse();
    assertThat(
            SafeSpots.isSafe(
                new Column().set(63, Ground.FLOOR).set(65, Ground.HAZARD), RANGE, at(64)))
        .isFalse();
  }

  @Test
  void theWorldsEdgesAreUnsafe() {
    var bottom = new Column().set(-64, Ground.FLOOR);
    assertThat(SafeSpots.isSafe(bottom, RANGE, at(-63))).isTrue();
    assertThat(SafeSpots.isSafe(bottom, RANGE, at(-64))).isFalse();
    assertThat(SafeSpots.isSafe(new Column(), RANGE, at(-200))).isFalse();

    var top = new Column().set(317, Ground.FLOOR);
    assertThat(SafeSpots.isSafe(top, RANGE, at(318))).isTrue();
    assertThat(SafeSpots.isSafe(new Column().set(318, Ground.FLOOR), RANGE, at(319))).isFalse();
  }

  @Test
  void findKeepsASafeDestination() {
    var column = new Column().set(63, Ground.FLOOR);

    assertThat(SafeSpots.find(column, RANGE, at(64))).contains(at(64));
  }

  @Test
  void findLiftsAPlayerOutOfTheGround() {
    var column = new Column().fill(50, 66, Ground.FLOOR);

    assertThat(SafeSpots.find(column, RANGE, at(64))).contains(at(67));
  }

  @Test
  void findLowersAPlayerOntoTheGround() {
    var column = new Column().fill(50, 60, Ground.FLOOR);

    assertThat(SafeSpots.find(column, RANGE, at(66))).contains(at(61));
  }

  @Test
  void findPrefersTheNearerSpotAndUpOnATie() {
    var column = new Column().set(60, Ground.FLOOR).set(64, Ground.FLOOR);

    // Feet at 63 have no floor; 65 (on 64) and 61 (on 60) are both two away.
    assertThat(SafeSpots.find(column, RANGE, at(63))).contains(at(65));
  }

  @Test
  void findGivesUpBeyondTheSearchDistance() {
    var column = new Column().set(64 - SafeSpots.SEARCH_DISTANCE - 2, Ground.FLOOR);

    assertThat(SafeSpots.find(column, RANGE, at(64))).isEmpty();
  }

  @Test
  void findReachesExactlyTheSearchDistance() {
    var column = new Column().set(64 - SafeSpots.SEARCH_DISTANCE - 1, Ground.FLOOR);

    assertThat(SafeSpots.find(column, RANGE, at(64))).contains(at(64 - SafeSpots.SEARCH_DISTANCE));
  }

  @Test
  void findNeverSendsAPlayerIntoLavaOrTheVoid() {
    var lavaLake = new Column().fill(50, 63, Ground.HAZARD);
    assertThat(SafeSpots.find(lavaLake, RANGE, at(64))).isEmpty();
    assertThat(SafeSpots.find(new Column(), RANGE, at(-60))).isEmpty();
  }

  @Test
  void blockPositionsFloorCoordinates() {
    assertThat(BlockPos.of(new Position("world", -0.5, 64.99, 3.2, 0, 0)))
        .isEqualTo(new BlockPos(-1, 64, 3));
  }

  @Test
  void heightRangesMustBeOrdered() {
    assertThatThrownBy(() -> new HeightRange(10, 10)).isInstanceOf(IllegalArgumentException.class);
  }
}
