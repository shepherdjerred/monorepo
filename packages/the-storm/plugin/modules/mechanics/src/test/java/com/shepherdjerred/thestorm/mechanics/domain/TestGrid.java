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
import com.shepherdjerred.thestorm.mechanics.domain.structure.Binding;
import com.shepherdjerred.thestorm.mechanics.domain.structure.BlockChange;
import com.shepherdjerred.thestorm.mechanics.domain.structure.SignRecord;
import com.shepherdjerred.thestorm.mechanics.domain.structure.SignRecords;
import com.shepherdjerred.thestorm.mechanics.domain.structure.Stock;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * An in-memory world for domain tests: air everywhere unless set, build height -64 to 320.
 *
 * <p>It simulates physics the way a real server would hurt a mechanism: removing a block that holds
 * up a sign pops the sign off, and whatever the sign held drops as items ({@link #dropped}). Signs
 * also carry the data a real sign stores (binding and stock), so it serves as the binder's {@link
 * SignRecords}.
 */
public final class TestGrid implements BlockGrid, SignRecords {

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
  private final Map<Pos, Binding> bindings = new HashMap<>();
  private final Map<Pos, Stock> stocks = new HashMap<>();
  private final Set<Pos> holdingUp = new HashSet<>();
  private final Map<String, Long> dropped = new HashMap<>();

  public TestGrid set(Pos pos, Cell cell) {
    cells.put(pos, cell);
    signs.remove(pos);
    bindings.remove(pos);
    stocks.remove(pos);
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

  /** Marks {@code pos} as holding up something (a torch, rail, painting) besides signs. */
  public TestGrid holdsUp(Pos pos) {
    holdingUp.add(pos);
    return this;
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
    set(pos, new Cell(material, Shape.PASSABLE, Mobility.BREAK, true));
    signs.put(pos, view);
    return this;
  }

  public TestGrid bind(Pos sign, Binding binding) {
    requireSign(sign);
    bindings.put(sign, binding);
    return this;
  }

  public TestGrid stock(Pos sign, Stock stock) {
    requireSign(sign);
    stocks.put(sign, stock);
    return this;
  }

  public Stock stockAt(Pos sign) {
    return stocks.getOrDefault(sign, Stock.empty());
  }

  public Optional<Binding> bindingAt(Pos sign) {
    return Optional.ofNullable(bindings.get(sign));
  }

  /** Breaks a sign as a player would: it and everything it holds drop. */
  public void breakSign(Pos sign) {
    requireSign(sign);
    drop(stockAt(sign));
    air(sign);
  }

  /** How many of {@code material} have dropped as items from broken or popped signs. */
  public long dropped(String material) {
    return dropped.getOrDefault(material, 0L);
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

  /**
   * Applies changes as the adapter would, checking each still finds what its plan saw. Removing a
   * block pops off every sign it holds up, as physics would.
   */
  public void apply(List<BlockChange> changes) {
    for (var change : changes) {
      if (!cellAt(change.pos()).is(change.from())) {
        throw new AssertionError("plan expected " + change.from() + " at " + change.pos());
      }
      if (change.isRemoval()) {
        air(change.pos());
        popSignsOn(change.pos());
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

  /** How many blocks of {@code material} all signs hold. */
  public long heldAll(String material) {
    return stocks.values().stream()
        .filter(stock -> stock.material().filter(material::equals).isPresent())
        .mapToLong(Stock::count)
        .sum();
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
  public boolean supports(Pos pos) {
    return holdingUp.contains(pos) || signs.keySet().stream().anyMatch(sign -> heldBy(sign, pos));
  }

  @Override
  public Optional<SignRecord> at(Pos pos) {
    return signAt(pos).map(view -> new SignRecord(view.mechanism(), bindingAt(pos), stockAt(pos)));
  }

  @Override
  public int minY() {
    return -64;
  }

  @Override
  public int maxY() {
    return 320;
  }

  /** Whether the sign at {@code sign} hangs on or stands on {@code block}. */
  private boolean heldBy(Pos sign, Pos block) {
    var view = signAt(sign).orElseThrow();
    var support =
        view.mount() == Mount.WALL
            ? sign.offset(view.facing().orElseThrow().opposite())
            : sign.offset(Direction.DOWN);
    return support.equals(block);
  }

  private void popSignsOn(Pos block) {
    var popped = signs.keySet().stream().filter(sign -> heldBy(sign, block)).toList();
    popped.forEach(this::breakSign);
  }

  private void drop(Stock stock) {
    stock.material().ifPresent(material -> dropped.merge(material, stock.count(), Long::sum));
  }

  private void requireSign(Pos sign) {
    if (!signs.containsKey(sign)) {
      throw new AssertionError("no sign at " + sign);
    }
  }
}
