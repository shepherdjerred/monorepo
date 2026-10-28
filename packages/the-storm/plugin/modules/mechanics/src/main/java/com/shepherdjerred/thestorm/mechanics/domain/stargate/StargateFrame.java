package com.shepherdjerred.thestorm.mechanics.domain.stargate;

import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Geometry of the downloaded Stargate plugin's default obsidian gate. */
public record StargateFrame(Pos origin, Direction across, Shape shape) {
  private static final String OBSIDIAN = "minecraft:obsidian";

  public enum Shape {
    PLAYER,
    CIRCLE
  }

  public StargateFrame(Pos origin, Direction across) {
    this(origin, across, Shape.PLAYER);
  }

  /** Origin is the left-hand block of the bottom pair; across points along the frame. */
  public StargateFrame {
    java.util.Objects.requireNonNull(shape, "shape");
    if (!across.isHorizontal()) {
      throw new IllegalArgumentException("a Stargate frame must face horizontally");
    }
  }

  /** The obsidian outline, including the blocks that carry its controls. */
  public List<Pos> frameBlocks() {
    if (shape == Shape.CIRCLE) return circleFrame();
    var result = new ArrayList<Pos>();
    for (var y = 0; y < 5; y++) {
      if (y == 0 || y == 4) {
        result.add(at(0, y));
        result.add(at(1, y));
      } else {
        result.add(at(-1, y));
        result.add(at(2, y));
      }
    }
    return List.copyOf(result);
  }

  private List<Pos> circleFrame() {
    var result = new ArrayList<Pos>();
    for (var y = 0; y < 7; y++) {
      if (y == 0 || y == 6) {
        for (var x = -1; x <= 1; x++) result.add(at(x, y));
      } else {
        var side = y == 1 || y == 5 ? 2 : 3;
        result.add(at(-side, y));
        result.add(at(side, y));
      }
    }
    return List.copyOf(result);
  }

  /** The blocks filled by an open portal. */
  public List<Pos> interior() {
    var result = new ArrayList<Pos>();
    if (shape == Shape.CIRCLE) {
      for (var y = 1; y < 6; y++) {
        var radius = y == 1 || y == 5 ? 1 : 2;
        for (var x = -radius; x <= radius; x++) result.add(at(x, y));
      }
      return List.copyOf(result);
    }
    for (var y = 1; y <= 3; y++) {
      result.add(at(0, y));
      result.add(at(1, y));
    }
    return List.copyOf(result);
  }

  /** A closed gate requires intact obsidian and an unobstructed interior. */
  public boolean isClosed(BlockGrid grid) {
    return frameBlocks().stream()
            .allMatch(pos -> grid.contains(pos) && grid.cellAt(pos).is(OBSIDIAN))
        && interior().stream().allMatch(pos -> grid.contains(pos) && grid.cellAt(pos).is(Cell.AIR));
  }

  /**
   * Finds a supported frame from a wall sign on either middle control block. The sign's facing
   * points away from its supporting obsidian. Frames must be complete and their interior empty.
   */
  public static Optional<StargateFrame> find(BlockGrid grid, Pos sign, Direction facing) {
    if (!facing.isHorizontal()) return Optional.empty();
    var across = facing.clockwise();
    var support = sign.offset(facing.opposite());
    var base = support.offset(Direction.DOWN, 2);
    var candidates =
        List.of(
            new StargateFrame(base.offset(across), across),
            new StargateFrame(base.offset(across, -2), across),
            new StargateFrame(base.offset(across, 3), across, Shape.CIRCLE),
            new StargateFrame(base.offset(across, -3), across, Shape.CIRCLE));
    var matches = candidates.stream().filter(frame -> frame.isClosed(grid)).toList();
    // Sharing a control block between frames is ambiguous and must not bind either one.
    return matches.size() == 1 ? Optional.of(matches.getFirst()) : Optional.empty();
  }

  /** The two blocks on which the sign and button are mounted. */
  public List<Pos> controls() {
    if (shape == Shape.CIRCLE) return List.of(at(-3, 2), at(3, 2));
    return List.of(at(-1, 2), at(2, 2));
  }

  private Pos at(int x, int y) {
    return origin.offset(across, x).offset(Direction.UP, y);
  }
}
