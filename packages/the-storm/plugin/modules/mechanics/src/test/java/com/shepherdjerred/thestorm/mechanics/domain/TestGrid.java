package com.shepherdjerred.thestorm.mechanics.domain;

import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mobility;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mount;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Shape;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.piston.BlockMove;
import com.shepherdjerred.thestorm.mechanics.domain.structure.BlockChange;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** An in-memory world for domain tests: air everywhere unless set, build height -64 to 320. */
public final class TestGrid implements BlockGrid {

  public static final String STONE = "minecraft:stone";
  public static final String PLANKS = "minecraft:oak_planks";
  public static final String SPRUCE = "minecraft:spruce_planks";
  public static final String FENCE = "minecraft:oak_fence";
  public static final String SPRUCE_FENCE = "minecraft:spruce_fence";
  public static final String WATER = "minecraft:water";
  public static final String SIGN = "minecraft:oak_sign";
  public static final String WALL_SIGN = "minecraft:oak_wall_sign";

  private final Map<Pos, Cell> cells = new HashMap<>();
  private final Map<Pos, SignView> signs = new HashMap<>();

  public TestGrid set(Pos pos, Cell cell) {
    cells.put(pos, cell);
    signs.remove(pos);
    return this;
  }

  public TestGrid solid(Pos pos, String material) {
    return set(pos, Cell.solid(material));
  }

  public TestGrid air(Pos pos) {
    return set(pos, Cell.air());
  }

  public TestGrid water(Pos pos) {
    return set(pos, new Cell(WATER, Shape.LIQUID, Mobility.BREAK, false));
  }

  public TestGrid passable(Pos pos, String material) {
    return set(pos, new Cell(material, Shape.PASSABLE, Mobility.BREAK, false));
  }

  public TestGrid hazard(Pos pos, String material) {
    return set(pos, new Cell(material, Shape.HAZARD, Mobility.NORMAL, false));
  }

  /** A standing sign reading {@code tag} on its second line, text facing {@code facing}. */
  public TestGrid sign(Pos pos, String tag, Direction facing) {
    return sign(pos, new SignView(List.of("", tag, "", ""), Mount.STANDING, Optional.of(facing)));
  }

  public TestGrid wallSign(Pos pos, String tag, Direction facing) {
    return sign(pos, new SignView(List.of("", tag, "", ""), Mount.WALL, Optional.of(facing)));
  }

  public TestGrid sign(Pos pos, SignView view) {
    var material = view.mount() == Mount.WALL ? WALL_SIGN : SIGN;
    cells.put(pos, new Cell(material, Shape.PASSABLE, Mobility.BREAK, true));
    signs.put(pos, view);
    return this;
  }

  /** Fills every position from {@code from} to {@code to} inclusive with {@code material}. */
  public TestGrid fill(Pos from, Pos to, String material) {
    for (var x = Math.min(from.x(), to.x()); x <= Math.max(from.x(), to.x()); x++) {
      for (var y = Math.min(from.y(), to.y()); y <= Math.max(from.y(), to.y()); y++) {
        for (var z = Math.min(from.z(), to.z()); z <= Math.max(from.z(), to.z()); z++) {
          solid(new Pos(x, y, z), material);
        }
      }
    }
    return this;
  }

  /** Applies changes as the adapter would, checking each still finds what its plan saw. */
  public void apply(List<BlockChange> changes) {
    for (var change : changes) {
      if (!cellAt(change.pos()).is(change.from())) {
        throw new AssertionError("plan expected " + change.from() + " at " + change.pos());
      }
      if (change.isRemoval()) {
        air(change.pos());
      } else {
        solid(change.pos(), change.to());
      }
    }
  }

  /** Moves blocks as the adapter would, in plan order. */
  public void move(List<BlockMove> moves) {
    for (var move : moves) {
      if (!cellAt(move.to()).shape().isPlaceable()) {
        throw new AssertionError("move into an occupied space at " + move.to());
      }
      var cell = cellAt(move.from());
      set(move.to(), cell);
      air(move.from());
    }
  }

  /** How many of {@code positions} hold {@code material}. */
  public long count(Collection<Pos> positions, String material) {
    return positions.stream().filter(pos -> cellAt(pos).is(material)).count();
  }

  /** How many blocks of {@code material} the whole grid holds. */
  public long countAll(String material) {
    return cells.values().stream().filter(cell -> cell.is(material)).count();
  }

  @Override
  public Cell cellAt(Pos pos) {
    return cells.getOrDefault(pos, Cell.air());
  }

  @Override
  public Optional<SignView> signAt(Pos pos) {
    return Optional.ofNullable(signs.get(pos));
  }

  @Override
  public int minY() {
    return -64;
  }

  @Override
  public int maxY() {
    return 320;
  }
}
