package com.shepherdjerred.thestorm.qol.domain.grave;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement.Cell;
import com.shepherdjerred.thestorm.qol.domain.grave.GravePlacement.HeightRange;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class GravePlacementTest {

  static final HeightRange WORLD = new HeightRange(-64, 320);

  /** Open air everywhere unless set; a flat floor at y 63 and below when {@code floored}. */
  static final class Blocks implements GravePlacement.BlockView {
    final Map<GravePos, Cell> cells = new HashMap<>();
    final boolean floored;

    Blocks(boolean floored) {
      this.floored = floored;
    }

    Blocks set(int x, int y, int z, Cell cell) {
      cells.put(new GravePos("world", x, y, z), cell);
      return this;
    }

    @Override
    public Cell at(int x, int y, int z) {
      var cell = cells.get(new GravePos("world", x, y, z));
      if (cell != null) {
        return cell;
      }
      return floored && y <= 63 ? Cell.FLOOR : Cell.OPEN;
    }
  }

  static GravePos at(int x, int y, int z) {
    return new GravePos("world", x, y, z);
  }

  static final GravePlacement PLACEMENT = new GravePlacement(3);

  @Test
  void anOpenSpotOnTheGroundIsUsedAsIs() {
    assertThat(PLACEMENT.find(new Blocks(true), WORLD, at(0, 64, 0))).contains(at(0, 64, 0));
  }

  @Test
  void aDeathInMidAirLandsOnTheGroundBelowWhenInRange() {
    assertThat(PLACEMENT.find(new Blocks(true), WORLD, at(0, 66, 0))).contains(at(0, 64, 0));
  }

  @Test
  void farAboveTheGroundTheGraveFloatsWhereThePlayerDied() {
    assertThat(PLACEMENT.find(new Blocks(true), WORLD, at(5, 100, 5))).contains(at(5, 100, 5));
  }

  @Test
  void aDeathInsideABlockMovesToTheNearestOpenFloor() {
    var blocks = new Blocks(true).set(0, 64, 0, Cell.BLOCKED);
    assertThat(PLACEMENT.find(blocks, WORLD, at(0, 64, 0))).contains(at(-1, 64, 0));
  }

  @Test
  void hazardsAndBlockedCellsAreNeverUsed() {
    var blocks =
        new Blocks(true)
            .set(0, 64, 0, Cell.HAZARD)
            .set(-1, 64, 0, Cell.BLOCKED)
            .set(0, 64, -1, Cell.HAZARD);
    assertThat(PLACEMENT.find(blocks, WORLD, at(0, 64, 0))).contains(at(0, 64, 1));
  }

  @Test
  void aHazardIsNotFloor() {
    var lavaLake = new Blocks(false);
    for (var x = -3; x <= 3; x++) {
      for (var z = -3; z <= 3; z++) {
        lavaLake.set(x, 63, z, Cell.HAZARD);
      }
    }
    lavaLake.set(3, 63, 0, Cell.FLOOR);
    assertThat(PLACEMENT.find(lavaLake, WORLD, at(0, 64, 0))).contains(at(3, 64, 0));
  }

  @Test
  void withNoFloorInRangeTheNearestOpenCellIsUsed() {
    assertThat(PLACEMENT.find(new Blocks(false), WORLD, at(0, 64, 0))).contains(at(0, 64, 0));
  }

  @Test
  void aSolidBoxHasNoSpot() {
    var solid =
        new GravePlacement.BlockView() {
          @Override
          public Cell at(int x, int y, int z) {
            return Cell.FLOOR;
          }
        };
    assertThat(PLACEMENT.find(solid, WORLD, at(0, 64, 0))).isEmpty();
  }

  @Test
  void theOriginIsMovedIntoTheWorldsHeight() {
    var floorAtBottom = new Blocks(false).set(0, -64, 0, Cell.FLOOR);
    assertThat(PLACEMENT.find(floorAtBottom, WORLD, at(0, -200, 0))).contains(at(0, -63, 0));
    assertThat(PLACEMENT.find(new Blocks(false), WORLD, at(0, 500, 0))).contains(at(0, 319, 0));
  }

  @Test
  void theBottomBlockHasNoFloorBelowIt() {
    var nothing = new Blocks(false);
    var found = new GravePlacement(0).find(nothing, WORLD, at(0, -64, 0));
    assertThat(found).contains(at(0, -64, 0));
  }

  @Test
  void equalDistancesPreferTheSameHeightThenUp() {
    var blocks = new Blocks(false).set(0, 64, 0, Cell.BLOCKED);
    // Six neighbours at distance 1; same height beats up and down, lowest x then z first.
    assertThat(PLACEMENT.find(blocks, WORLD, at(0, 64, 0))).contains(at(-1, 64, 0));
    var sidesBlocked =
        new Blocks(false)
            .set(0, 64, 0, Cell.BLOCKED)
            .set(-1, 64, 0, Cell.BLOCKED)
            .set(1, 64, 0, Cell.BLOCKED)
            .set(0, 64, -1, Cell.BLOCKED)
            .set(0, 64, 1, Cell.BLOCKED);
    assertThat(PLACEMENT.find(sidesBlocked, WORLD, at(0, 64, 0))).contains(at(0, 65, 0));
  }

  @Test
  void theRadiusIsBounded() {
    assertThatThrownBy(() -> new GravePlacement(-1)).hasMessageContaining("radius");
    assertThatThrownBy(() -> new GravePlacement(9)).hasMessageContaining("radius");
    assertThatThrownBy(() -> new HeightRange(10, 10)).hasMessageContaining("max");
  }

  @Test
  void aSmallRadiusOnlyLooksNearby() {
    var blocks = new Blocks(false).set(0, 64, 0, Cell.BLOCKED);
    assertThat(new GravePlacement(0).find(blocks, WORLD, at(0, 64, 0))).isEmpty();
  }
}
