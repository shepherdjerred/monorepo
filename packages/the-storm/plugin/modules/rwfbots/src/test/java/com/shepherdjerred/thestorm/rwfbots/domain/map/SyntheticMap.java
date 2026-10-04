package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.List;
import java.util.Optional;

/**
 * A 32 by 8 by 32 arena: a stone floor at y=0, a three-high wall across x=16 with a two-wide door
 * at z=15..16 and a glass window at z=20..21, a one-block step at (8, 1, 8), red's spawn and bomb
 * on the west side, blue's on the east.
 */
public final class SyntheticMap implements BlockClassification {

  public static final int SIZE = 32;
  public static final int HEIGHT = 8;
  public static final int WALL_X = 16;
  public static final BlockPos RED_SPAWN = new BlockPos(2, 1, 2);
  public static final BlockPos BLUE_SPAWN = new BlockPos(30, 1, 30);
  public static final BlockPos RED_BOMB = new BlockPos(4, 1, 16);
  public static final BlockPos BLUE_BOMB = new BlockPos(28, 1, 16);
  public static final BlockPos STEP = new BlockPos(8, 1, 8);

  private final GridBounds bounds = new GridBounds(new BlockPos(0, 0, 0), SIZE, HEIGHT, SIZE);
  private final BlockShape[] shapes = new BlockShape[bounds.volume()];
  private final boolean doorOpen;

  public SyntheticMap(boolean doorOpen) {
    this.doorOpen = doorOpen;
    for (var y = 0; y < HEIGHT; y++) {
      for (var z = 0; z < SIZE; z++) {
        for (var x = 0; x < SIZE; x++) {
          shapes[bounds.index(x, y, z)] = classify(x, y, z);
        }
      }
    }
  }

  public static SyntheticMap open() {
    return new SyntheticMap(true);
  }

  public static NavSites sites() {
    return new NavSites(
        List.of(
            new NavSites.Site("red-spawn", Optional.of("red"), RED_SPAWN),
            new NavSites.Site("blue-spawn", Optional.of("blue"), BLUE_SPAWN)),
        List.of(
            new NavSites.Site("red-bomb", Optional.of("red"), RED_BOMB),
            new NavSites.Site("blue-bomb", Optional.of("blue"), BLUE_BOMB)));
  }

  public static NavArtifact bake() {
    return MapBaker.bake("synthetic", open(), sites());
  }

  private BlockShape classify(int x, int y, int z) {
    if (y == 0) {
      return BlockShape.FULL;
    }
    if (RED_BOMB.equals(new BlockPos(x, y, z)) || BLUE_BOMB.equals(new BlockPos(x, y, z))) {
      return BlockShape.FULL;
    }
    if (STEP.equals(new BlockPos(x, y, z))) {
      return BlockShape.FULL;
    }
    if (x == WALL_X && y <= 3) {
      if (doorOpen && (z == 15 || z == 16)) {
        return BlockShape.PASSABLE;
      }
      if (z == 20 || z == 21) {
        return BlockShape.PANE;
      }
      return BlockShape.FULL;
    }
    return BlockShape.PASSABLE;
  }

  @Override
  public GridBounds bounds() {
    return bounds;
  }

  @Override
  public BlockShape shape(int x, int y, int z) {
    return shapes[bounds.index(x, y, z)];
  }

  @Override
  public boolean blocksSight(int x, int y, int z) {
    var shape = shape(x, y, z);
    return shape.blocksMovement() && shape != BlockShape.PANE;
  }
}
